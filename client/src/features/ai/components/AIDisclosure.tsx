/**
 * The AI processing disclosure, and the version it is (Astra #255 r3).
 *
 * A consent grant names the version of the disclosure the owner or admin was
 * shown; the server refuses a stale or missing version. Bump the version
 * together with the copy, and with `CURRENT_AI_CONSENT_VERSION` on the server
 * (server/modules/ai/ai.consent-policy.ts).
 */

export const AI_DISCLOSURE_VERSION = "v2.0";

export function AIDisclosure() {
  return (
    <>
      <p>
        Thandi normally uses Anthropic Claude to answer your financial
        questions. If Claude is unavailable, Google Gemini may process the
        request instead.
      </p>
      <p>
        Your question, selected recent conversation messages and the
        financial summaries needed to answer may be sent to the provider
        used. Questions you type can contain personal information.
      </p>
    </>
  );
}
