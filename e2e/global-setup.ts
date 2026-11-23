import fs from "node:fs/promises";
import path from "node:path";
import type { FullConfig } from "@playwright/test";
import { prepareBrowserClient } from "../server/testing/browser-client.mjs";

const DEFAULT_BASE_URL = "http://localhost:5000";
const BASE_TEST_USER = {
  email: "test@example.com",
  username: "testuser",
  password: "TestPass123!",
  fullName: "Test User",
};
const CREDENTIALS_PATH = path.resolve(
  process.cwd(),
  "e2e",
  ".auth",
  "credentials.json",
);

const wait = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const safeJson = async (response: Response) => {
  try {
    return await response.clone().json();
  } catch (error) {
    try {
      const text = await response.clone().text();
      return text ? { rawText: text } : null;
    } catch (textError) {
      return null;
    }
  }
};

const extractCookieValue = (
  setCookie: string | string[] | null,
  name: string,
) => {
  if (!setCookie) return null;
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const cookie of cookies) {
    const trimmed = cookie.trim();
    if (trimmed.startsWith(`${name}=`)) {
      return trimmed.split(";")[0] ?? null;
    }
  }
  // Fallback: regex search across all cookies
  const match = cookies.join("; ").match(new RegExp(`${name}=[^;]+`));
  return match?.[0] ?? null;
};

const ensureCredentialsDir = async () => {
  await fs.mkdir(path.dirname(CREDENTIALS_PATH), { recursive: true });
};

const writeCredentials = async (user: typeof BASE_TEST_USER) => {
  await ensureCredentialsDir();
  await fs.writeFile(
    CREDENTIALS_PATH,
    JSON.stringify(
      {
        email: user.email,
        password: user.password,
        username: user.username,
      },
      null,
      2,
    ),
    "utf-8",
  );
};

const ensureTestUserLoginReady = async (email: string) => {
  const [{ db }, { users }, { eq }] = await Promise.all([
    import("../server/db"),
    import("../shared/schema"),
    import("drizzle-orm"),
  ]);

  await db
    .update(users)
    .set({
      emailVerified: true,
      emailVerificationToken: null,
      emailVerificationExpiry: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastFailedLoginAt: null,
      mfaEnabled: false,
      mfaCode: null,
      mfaCodeExpiry: null,
      updatedAt: new Date(),
    })
    .where(eq(users.email, email));
};

const waitForServer = async (baseURL: string, timeoutMs: number) => {
  const healthUrl = new URL("/api/health/routes", baseURL).toString();
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(healthUrl);
      if (response.ok) {
        return;
      }
    } catch (error) {
      // Ignore startup connection errors.
    }

    await wait(1000);
  }

  throw new Error(`Server did not become ready at ${healthUrl}`);
};

const resolveBaseUrl = (config: FullConfig) => {
  const projectBaseUrl = config.projects[0]?.use?.baseURL as
    | string
    | undefined;
  const configBaseUrl = config.use?.baseURL as string | undefined;
  return projectBaseUrl ?? configBaseUrl ?? DEFAULT_BASE_URL;
};

const buildUniqueUser = () => {
  const suffix = Date.now().toString();
  return {
    ...BASE_TEST_USER,
    email: `test${suffix}@example.com`,
    username: `testuser${suffix}`,
  };
};

const attemptRegister = async (baseURL: string, user: typeof BASE_TEST_USER) => {
  const registerUrl = new URL("/api/auth/register", baseURL).toString();
  const response = await fetch(registerUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(user),
  });

  const body = await safeJson(response);
  const setCookie =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : response.headers.get("set-cookie");
  const sessionCookie = extractCookieValue(setCookie, "connect.sid");
  console.log(
    `[e2e][register] status=${response.status} ok=${response.ok} cookie=${Boolean(
      sessionCookie,
    )}`,
  );
  return { ok: response.ok, body, status: response.status, sessionCookie };
};

const attemptLogin = async (baseURL: string, user: typeof BASE_TEST_USER) => {
  const loginUrl = new URL("/api/auth/login", baseURL).toString();
  const response = await fetch(loginUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: user.email,
      password: user.password,
      rememberMe: false,
    }),
  });

  const body = await safeJson(response);
  const requiresMfa = Boolean(body?.data?.requiresMfa);
  const setCookie =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : response.headers.get("set-cookie");
  const sessionCookie = extractCookieValue(setCookie, "connect.sid");
  const headerEntries = Array.from(response.headers.entries());
  console.log(
    `[e2e][login] status=${response.status} ok=${response.ok} cookie=${Boolean(
      sessionCookie,
    )} requiresMfa=${requiresMfa}`,
  );
  return {
    ok: response.ok,
    body,
    status: response.status,
    sessionCookie,
    requiresMfa,
    headers: headerEntries,
  };
};

const fetchWithCookies = async (
  url: string,
  options: RequestInit,
  cookies: string[],
) => {
  const headers = new Headers(options.headers);
  if (cookies.length > 0) {
    headers.set("Cookie", cookies.join("; "));
  }

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      return await fetch(url, { ...options, headers });
    } catch (error) {
      lastError = error;
      await wait(1000);
    }
  }

  throw new Error(`Fetch failed after retries: ${options.method ?? "GET"} ${url}`, {
    cause: lastError,
  });
};

const ensureHousehold = async (
  baseURL: string,
  sessionCookie: string,
) => {
  const householdUrl = new URL("/api/household/general", baseURL).toString();
  const generalResponse = await fetchWithCookies(
    householdUrl,
    { method: "GET" },
    [sessionCookie],
  );

  if (generalResponse.ok) {
    return;
  }

  const generalBody = await safeJson(generalResponse);
  const missingHousehold =
    generalResponse.status === 404 ||
    generalBody?.error?.message?.toLowerCase().includes("no household found");

  if (!missingHousehold) {
    throw new Error(
      `Failed to check household: ${generalResponse.status} ${
        generalBody?.error?.message ?? "Unknown error"
      }`,
    );
  }

  const csrfUrl = new URL("/api/csrf-token", baseURL).toString();
  const csrfResponse = await fetchWithCookies(
    csrfUrl,
    { method: "GET" },
    [sessionCookie],
  );
  if (!csrfResponse.ok) {
    throw new Error(`Failed to fetch CSRF token: ${csrfResponse.status}`);
  }

  const csrfBody = await safeJson(csrfResponse);
  const csrfToken = csrfBody?.csrfToken as string | undefined;
  if (!csrfToken) {
    throw new Error("Missing CSRF token in response");
  }

  const csrfSetCookie =
    typeof csrfResponse.headers.getSetCookie === "function"
      ? csrfResponse.headers.getSetCookie()
      : csrfResponse.headers.get("set-cookie");
  const csrfCookie = extractCookieValue(csrfSetCookie, "csrf-token");
  const createUrl = new URL("/api/household", baseURL).toString();
  const createResponse = await fetchWithCookies(
    createUrl,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
      },
      body: JSON.stringify({
        name: "Test Household",
        currency: "ZMW",
      }),
    },
    [sessionCookie, csrfCookie].filter(Boolean) as string[],
  );

  if (createResponse.ok || createResponse.status === 409) {
    return;
  }

  const createBody = await safeJson(createResponse);
  throw new Error(
    `Failed to create household: ${createResponse.status} ${
      createBody?.error?.message ?? "Unknown error"
    }`,
  );
};

const resolveTestUser = async (baseURL: string) => {
  const baseRegistration = await attemptRegister(baseURL, BASE_TEST_USER);
  if (baseRegistration.ok) {
    return { user: BASE_TEST_USER, sessionCookie: baseRegistration.sessionCookie };
  }

  if (baseRegistration.body?.error?.code === "DUPLICATE_ENTRY") {
    const loginAttempt = await attemptLogin(baseURL, BASE_TEST_USER);
    if (loginAttempt.ok && loginAttempt.sessionCookie && !loginAttempt.requiresMfa) {
      return { user: BASE_TEST_USER, sessionCookie: loginAttempt.sessionCookie };
    }
  }

  const uniqueUser = buildUniqueUser();
  const uniqueRegistration = await attemptRegister(baseURL, uniqueUser);
  if (!uniqueRegistration.ok) {
    throw new Error(
      `Failed to seed E2E user: ${uniqueRegistration.status} ${
        uniqueRegistration.body?.error?.message ?? "Unknown error"
      }`,
    );
  }
  return { user: uniqueUser, sessionCookie: uniqueRegistration.sessionCookie };
};

export default async function globalSetup(config: FullConfig) {
  const baseURL = resolveBaseUrl(config);
  await prepareBrowserClient(baseURL);
  console.log(`[e2e] globalSetup start baseURL=${baseURL}`);
  await waitForServer(baseURL, 60_000);
  console.log("[e2e] server ready");

  const resolved = await resolveTestUser(baseURL);
  const resolvedUser = resolved.user;
  console.log(`[e2e] resolved user ${resolvedUser.email}`);
  await ensureTestUserLoginReady(resolvedUser.email);
  console.log("[e2e] test user auth state reset");

  let sessionCookie = resolved.sessionCookie ?? null;
  if (!sessionCookie) {
    console.log("[e2e] no session cookie from register, attempting login");
    const loginAttempt = await attemptLogin(baseURL, resolvedUser);
    if (!loginAttempt.ok || !loginAttempt.sessionCookie || loginAttempt.requiresMfa) {
      const rawText = loginAttempt.body?.rawText;
      const successFlag = loginAttempt.body?.success;
      throw new Error(
        `Failed to login E2E user: ${loginAttempt.status} ${
          loginAttempt.body?.error?.message ?? "Unknown error"
        }${loginAttempt.requiresMfa ? " (MFA required for this user)" : ""}` +
          ` | success=${successFlag ?? "unknown"} | raw=${rawText ?? "n/a"} | headers=${JSON.stringify(
            loginAttempt.headers
          )}`
      );
    }
    sessionCookie = loginAttempt.sessionCookie;
  }

  console.log("[e2e] session cookie acquired, ensuring household");
  await ensureHousehold(baseURL, sessionCookie);
  console.log("[e2e] household ensured, writing credentials");
  await writeCredentials(resolvedUser);
  console.log("[e2e] globalSetup complete");
}
