/**
 * @vitest-environment jsdom
 *
 * A 400 from /auth/register carries per-field messages in `error.fields`.
 * They must appear next to the matching input, not collapse to "Invalid input".
 * Uses the real handlers and apiCall with real Response objects (apiCall calls
 * response.clone()); only fetch and the toast are stubbed.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { toast } from "sonner";
import { clearCsrfToken } from "@/lib/api";
import { readFieldErrors } from "../authFieldErrors";
import Login from "../index";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() },
}));

const USERNAME_MESSAGE = "Username can only contain letters, numbers, underscores, and hyphens";
const PASSWORD_MESSAGE = "Password cannot be the same as your email";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const validationFailure = () =>
  json(
    {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid input",
        fields: [
          { field: "username", message: USERNAME_MESSAGE, code: "invalid_string" },
          { field: "password", message: PASSWORD_MESSAGE },
        ],
      },
    },
    400,
  );

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(
        String(input).includes("/csrf-token") ? json({ csrfToken: "test-csrf" }) : validationFailure(),
      ),
    ),
  );
}

function renderRegister() {
  window.history.pushState({}, "", "/login?mode=register");
  const location = memoryLocation({ path: "/login", record: true });
  render(
    <Router hook={location.hook}>
      <Login />
    </Router>,
  );
}

async function fillAndSubmit() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/full name/i), "Synthetic Person");
  await user.type(screen.getByLabelText(/username/i), "bad name");
  await user.type(screen.getByLabelText(/email/i), "person@example.test");
  await user.type(document.getElementById("registerPassword") as HTMLInputElement, "Synthetic-Pass-123!");
  await user.click(screen.getByRole("button", { name: /create account/i }));
  return user;
}

describe("registration field errors", () => {
  beforeEach(() => {
    clearCsrfToken();
    vi.mocked(toast.error).mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.pushState({}, "", "/");
  });

  it("shows each server field message next to its input and marks it invalid", async () => {
    stubFetch();
    renderRegister();

    await fillAndSubmit();

    const usernameMessage = await screen.findByText(USERNAME_MESSAGE);
    const username = screen.getByLabelText(/username/i);
    expect(username).toHaveAttribute("aria-invalid", "true");
    expect(username.getAttribute("aria-describedby")).toContain(usernameMessage.id);

    const passwordMessage = screen.getByText(PASSWORD_MESSAGE);
    const password = document.getElementById("registerPassword");
    expect(password).toHaveAttribute("aria-invalid", "true");
    // The requirements checklist stays described alongside the error.
    expect(password?.getAttribute("aria-describedby")).toContain(passwordMessage.id);
    expect(password?.getAttribute("aria-describedby")).toContain("password-requirements");

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Please correct the highlighted fields.");
    });
  });

  it("clears a field message once that field is edited", async () => {
    stubFetch();
    renderRegister();
    const user = await fillAndSubmit();
    await screen.findByText(USERNAME_MESSAGE);

    await user.type(screen.getByLabelText(/username/i), "x");

    expect(screen.queryByText(USERNAME_MESSAGE)).not.toBeInTheDocument();
    expect(screen.getByText(PASSWORD_MESSAGE)).toBeInTheDocument();
  });
});

describe("registration while a request is in flight", () => {
  beforeEach(() => clearCsrfToken());

  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.pushState({}, "", "/");
  });

  it("locks the inputs until the reply arrives, so the reply describes what is on screen", async () => {
    let reply: (response: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => { reply = resolve; });
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) =>
        String(input).includes("/csrf-token") ? Promise.resolve(json({ csrfToken: "test-csrf" })) : pending,
      ),
    );
    renderRegister();

    await fillAndSubmit();

    await waitFor(() => expect(screen.getByLabelText(/username/i)).toBeDisabled());
    expect(screen.getByLabelText(/full name/i)).toBeDisabled();
    expect(screen.getByLabelText(/email/i)).toBeDisabled();
    expect(document.getElementById("registerPassword")).toBeDisabled();

    reply(validationFailure());

    expect(await screen.findByText(USERNAME_MESSAGE)).toBeInTheDocument();
    expect(screen.getByLabelText(/username/i)).toBeEnabled();
  });
});

describe("readFieldErrors", () => {
  const fields = [{ field: "email", message: "Invalid email address", code: "invalid_string" }];

  it("reads fields from a thrown ApiError", () => {
    expect(readFieldErrors(Object.assign(new Error("Invalid input"), { fields }))).toEqual(fields);
  });

  it("reads fields from a returned error envelope", () => {
    expect(readFieldErrors({ success: false, error: { message: "Invalid input", fields } })).toEqual(fields);
  });

  it("ignores malformed entries", () => {
    expect(readFieldErrors({ fields: [{ field: "email" }, null, "x"] })).toEqual([]);
  });
});
