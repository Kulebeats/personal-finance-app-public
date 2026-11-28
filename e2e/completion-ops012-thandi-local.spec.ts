import { randomUUID } from "node:crypto";
import { test, expect } from "./protected-test";
import { createCompletionFixture } from "../server/testing/fixtures/completion-fixtures";
import { withFixtureClient } from "../server/testing/fixtures/fixture-context";
import { signInAs } from "./utils/fixture-session";
import { readBack, submitStep, type SubmitStep } from "./utils/submit";
import { testWithMutants } from "./utils/mutants";

/**
 * OPS-012: Thandi is honest when no AI provider is configured (the test server
 * has neither key). After the owner grants consent in the browser, an answer is
 * labelled as a limited local summary, never as a Claude or Gemini answer, and
 * the status route reports both providers as not configured.
 *
 * Read-back: the exchange is read back through the API (the stored thread) and
 * the database (the ai_requests admission row and the ai_query audit row, which
 * names the same request, the question asked, local mode and no paid call).
 * The question is the mutation-checked field (QA-01 / R20.2): a mutant sends
 * a different question, and the read-back of the stored and audited question
 * must see it.
 */
const QUESTION = "What are my account balances?";
const LOCAL_LABEL = "Limited local summary";
/** The default provider order with no AI_PRIMARY_PROVIDER / AI_FALLBACK_PROVIDER set (ai.provider-config.ts). */
const EXPECTED_PROVIDERS = ["anthropic", "gemini"];
const ASK: SubmitStep = { name: "thandi-chat", method: "POST", path: "/api/ai/chat", corruptField: "message" };

interface ProviderStatus { provider: string; configured: boolean; unavailableReason: string | null }
interface StoredMessage { role: "user" | "assistant"; content: string }
interface RequestRow { id: string; client_request_key: string; status: string; answer_mode: string | null;
  chat_quota_state: string; conversation_id: string | null }
interface AuditRow { entity_id: string | null; details: Record<string, unknown> }

async function readExchange(householdId: string) {
  return withFixtureClient(async (client) => {
    const requests = await client.query<RequestRow>(
      `SELECT id, client_request_key, status, answer_mode, chat_quota_state, conversation_id
         FROM ai_requests WHERE household_id = $1`, [householdId]);
    const audits = await client.query<AuditRow>(
      "SELECT entity_id, details FROM audit_logs WHERE household_id = $1 AND entity_type = 'ai_query'", [householdId]);
    return { requests: requests.rows, audits: audits.rows };
  });
}

testWithMutants("with no provider configured Thandi labels its answer as a local summary", { corrupt: [ASK] }, async (page) => {
  const fixture = await createCompletionFixture();
  await withFixtureClient(client => client.query(
    "INSERT INTO accounts (id, household_id, name, type, balance, currency, is_private) VALUES ($1, $2, $3, 'checking', 150, 'ZMW', false)",
    [randomUUID(), fixture.householdId, `OPS012 account ${randomUUID().slice(0, 8)}`]));
  await signInAs(page, fixture);

  const status = await page.request.get("/api/ai/status");
  expect(status.status()).toBe(200);
  const statusBody = await status.json();
  const health = statusBody.data ?? statusBody;
  const providers: ProviderStatus[] = health.providers ?? [];
  // A loop over an empty list would pass without checking anything.
  expect(providers.map((entry) => entry.provider)).toEqual(EXPECTED_PROVIDERS);
  for (const provider of providers) {
    expect(provider.configured, `${provider.provider} is not configured`).toBe(false);
    expect(provider.unavailableReason).toBe("not_configured");
  }
  expect(health.state).toBe("unconfigured");

  await page.goto("/advice");
  await expect(page.getByRole("heading", { name: "Thandi (AI Assistant)", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Enable Thandi", exact: true }).click();

  const composer = page.getByRole("textbox", { name: "Ask Thandi a question", exact: true });
  await composer.fill(QUESTION);
  const reply = await submitStep(page, ASK, () => page.getByRole("button", { name: "Send", exact: true }).click());
  expect(reply.status()).toBe(200);
  const replyBody = await reply.json();
  const answer = replyBody.data ?? replyBody;
  expect(answer.conversationId, "a local answer is stored in a thread").toEqual(expect.any(String));

  // API and DB read-back of the question: the stored thread and the audit row.
  const thread = async (): Promise<StoredMessage[]> => {
    const response = await page.request.get(`/api/ai/conversations/${answer.conversationId}`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    return (body.data ?? body).messages ?? [];
  };
  await readBack(ASK, QUESTION, {
    api: async () => (await thread()).find((message) => message.role === "user")?.content ?? "(no user message)",
    db: async () => {
      const { audits } = await readExchange(fixture.householdId);
      return String(audits[0]?.details.query ?? "(no ai_query audit row)");
    },
  });
  expect(answer.answerMode).toBe("local");

  await expect(page.getByText(LOCAL_LABEL, { exact: true })).toBeVisible();
  await expect(page.getByText(/Answered using (Claude|Gemini)/)).toHaveCount(0);

  // The stored thread holds exactly the question and the labelled local answer.
  const messages = await thread();
  expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
  expect(messages[0].content).toBe(QUESTION);
  expect(messages[1].content.startsWith(LOCAL_LABEL), "the stored answer keeps its local label").toBe(true);

  // DB read-back: one admission, settled as a consumed local answer, and its audit row.
  const { requests, audits } = await readExchange(fixture.householdId);
  expect(requests).toHaveLength(1);
  const [request] = requests;
  expect(request).toMatchObject({
    status: "completed", answer_mode: "local", chat_quota_state: "consumed", conversation_id: answer.conversationId,
  });
  const sent = reply.request().postDataJSON() as { clientRequestKey?: string };
  if (sent.clientRequestKey) expect(request.client_request_key).toBe(sent.clientRequestKey);
  expect(audits).toHaveLength(1);
  const [audit] = audits;
  expect(audit.entity_id).toBe(answer.conversationId);
  expect(audit.details).toMatchObject({
    query: QUESTION,
    answer_mode: "local",
    logical_request_id: request.id,
    paid_calls: 0,
    provider_attempted: false,
  });
});
