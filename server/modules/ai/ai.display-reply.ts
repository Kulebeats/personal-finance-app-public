/**
 * What the person asking sees, as opposed to what a provider sees.
 *
 * - The sanitiser sends account names out as generic labels (`savings_1`,
 *   `account_2`). `DisplayNames` records, per request, which label stood for
 *   which of the asker's own visible accounts in the tool results actually
 *   built, and `restore` puts those names back into the reply.
 * - Replies are STORED with the labels, exactly as the provider wrote them, so
 *   a replayed turn never carries a raw name out (P1, #301 review). Names are
 *   put back only in what the asker is shown: the chat response here, and
 *   stored history through `nameAssistantMessages`.
 *
 * The provider's Markdown is kept: the chat renders it safely (ThandiMarkdown).
 */
import { goalAccountLabelPairs } from "./ai.goal-sanitizer";
import { accountLabelPairs } from "./ai.sanitizer";
import type { AccountBalanceResult, GoalAssignmentResult } from "./ai.types";

type LabelPair = readonly [label: string, name: string];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Label -> name pairs for one tool's raw (unsanitised) result. */
export function labelPairsFor(toolName: string, rawData: unknown): LabelPair[] {
  if (!Array.isArray(rawData)) return [];
  if (toolName === "get_account_balances") return accountLabelPairs(rawData as AccountBalanceResult[]);
  if (toolName === "get_goal_assignments") return goalAccountLabelPairs(rawData as GoalAssignmentResult[]);
  return [];
}

/** The labels sent out in one request, and the account names they stand for. */
export class DisplayNames {
  private readonly byLabel = new Map<string, string>();

  record(toolName: string, rawData: unknown): void {
    for (const [label, name] of labelPairsFor(toolName, rawData)) {
      this.byLabel.set(label, name);
    }
  }

  /** The reply with every label this request sent out replaced by its account name. */
  restore(text: string): string {
    if (this.byLabel.size === 0) return text;
    const pattern = new RegExp(`\\b(${[...this.byLabel.keys()].map(escapeRegExp).join("|")})\\b`, "g");
    return text.replace(pattern, (label) => this.byLabel.get(label) ?? label);
  }
}

/** Stored messages with the labels in Thandi's replies shown as account names; the asker's own words stay as typed. */
export function nameAssistantMessages<T extends { role: string; content: string }>(messages: readonly T[], names: DisplayNames): T[] {
  return messages.map((message) => (message.role === "assistant" ? { ...message, content: names.restore(message.content) } : message));
}
