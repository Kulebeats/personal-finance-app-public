/**
 * AI Guardrails Utilities
 *
 * Centralized safety and budget helpers for AI request handling.
 *
 * @module ai/ai.guardrails
 */

import type { ProviderToolCall as GeminiToolCall } from "./ai.provider.types";
import { AI_TOOL_NAMES as GEMINI_TOOL_NAMES } from "./ai.tool-definitions";

/**
 * Per-question token budget across every provider call (owner ruling, 21 Nov).
 * The first step alone (system prompt + tool declarations + question) used
 * about 2,600 tokens on Claude, so 2000 left nothing for the answer.
 */
export const DEFAULT_AI_REQUEST_TOKEN_BUDGET = 8000;
export const AI_TOOL_CALL_CAP = 2;

/**
 * OPEN-3: how many prior conversation messages may be replayed as model
 * context. 6 messages = 3 user/assistant turns. Deliberately modest: the
 * provider timeout is 10s and larger prompts nudge latency.
 */
export const DEFAULT_AI_CONTEXT_MAX_MESSAGES = 6;

const INJECTION_PATTERNS: Array<{ ruleId: string; pattern: RegExp }> = [
  {
    ruleId: "override_instructions",
    pattern:
      /\b(ignore|bypass|override)\b[\s\S]{0,80}\b(previous|prior|system|developer)\b[\s\S]{0,80}\b(instructions|rules|prompt)\b/i,
  },
  {
    ruleId: "reveal_hidden_prompt",
    pattern:
      /\b(reveal|show|print|dump|leak)\b[\s\S]{0,80}\b(system prompt|developer message|hidden instructions|internal prompt)\b/i,
  },
  {
    ruleId: "secrets_exfiltration",
    pattern:
      /\b(show|reveal|print|leak)\b[\s\S]{0,80}\b(api key|secret|token|password|credentials)\b/i,
  },
  {
    ruleId: "jailbreak_keywords",
    pattern: /\b(jailbreak|prompt injection|tool schema|function declaration)\b/i,
  },
  {
    ruleId: "xml_system_tag",
    pattern: /<\s*system\s*>/i,
  },
];

export interface HardenedMessageResult {
  value: string;
  wasModified: boolean;
}

export interface PromptInjectionAssessment {
  blocked: boolean;
  ruleId?: string;
}

export interface ToolAllowlistResult {
  allowedCalls: GeminiToolCall[];
  blockedCalls: GeminiToolCall[];
  droppedByCap: GeminiToolCall[];
}

export interface DataWindow {
  start: string;
  end: string;
}

export function getRequestTokenBudget(): number {
  const raw = process.env.AI_REQUEST_TOKEN_BUDGET;
  if (!raw) {
    return DEFAULT_AI_REQUEST_TOKEN_BUDGET;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_AI_REQUEST_TOKEN_BUDGET;
  }

  return parsed;
}

export function getContextMaxMessages(): number {
  const raw = process.env.AI_CONTEXT_MAX_MESSAGES;
  if (!raw) {
    return DEFAULT_AI_CONTEXT_MAX_MESSAGES;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_AI_CONTEXT_MAX_MESSAGES;
  }

  return parsed;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * A stored conversation message, as returned by `aiConversationService.get`.
 */
export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * A turn in provider (Gemini) role vocabulary. `assistant` maps to `model`.
 */
export interface PriorTurn {
  role: "user" | "model";
  text: string;
}

export interface HistoryDrop {
  role: "user" | "assistant";
  reason: "injection" | "budget";
  ruleId?: string;
}

export interface HistorySelection {
  /** Kept turns, OLDEST FIRST, ready to prepend to the current message. */
  turns: PriorTurn[];
  /** Post-trim token estimate for the history that will actually be sent. */
  historyTokens: number;
  /** Every message that was excluded, with the reason (for logging + audit). */
  dropped: HistoryDrop[];
}

/**
 * OPEN-3: choose which prior messages may be replayed into a new prompt.
 *
 * Three guarantees, in this order:
 *
 * 1. **N cap** — at most `maxMessages` of the most recent messages are even
 *    considered.
 * 2. **Injection re-scan** — stored USER messages are untrusted input being
 *    replayed into a fresh prompt, so the blocklist runs again at send time.
 *    A tripping message is DROPPED (not failed) and reported in `dropped`.
 *    Assistant messages are re-sent verbatim: they are sanitizer-derived
 *    output the household has already seen.
 * 3. **Token budget** — history must fit INSIDE the shipped request budget.
 *    `reservedTokens` (the current message + system prompt) is subtracted
 *    first and is never trimmable, so the current message ALWAYS survives;
 *    history is then filled newest-first and the overflow is dropped
 *    oldest-first.
 */
export function selectHistoryTurns(params: {
  messages: HistoryMessage[];
  reservedTokens: number;
  tokenBudget: number;
  maxMessages?: number;
}): HistorySelection {
  const {
    messages,
    reservedTokens,
    tokenBudget,
    maxMessages = getContextMaxMessages(),
  } = params;

  const dropped: HistoryDrop[] = [];

  // (1) N cap: only the most recent `maxMessages`, order preserved.
  const capped =
    maxMessages > 0 && messages.length > maxMessages
      ? messages.slice(messages.length - maxMessages)
      : maxMessages > 0
        ? messages
        : [];

  // (2) Injection re-scan over replayed user messages.
  const safe: HistoryMessage[] = [];
  for (const message of capped) {
    if (message.role === "user") {
      const assessment = detectPromptInjection(message.content);
      if (assessment.blocked) {
        dropped.push({
          role: "user",
          reason: "injection",
          ruleId: assessment.ruleId,
        });
        continue;
      }
    }
    safe.push(message);
  }

  // (3) Token budget. The current message + system prompt are already
  // reserved, so anything left over is all history may consume.
  const available = tokenBudget - reservedTokens;
  if (available <= 0) {
    for (const message of safe) {
      dropped.push({ role: message.role, reason: "budget" });
    }
    return { turns: [], historyTokens: 0, dropped };
  }

  // Fill newest-first so the freshest context wins; whatever no longer fits is
  // by construction the oldest.
  const keptReversed: HistoryMessage[] = [];
  let historyTokens = 0;
  for (let i = safe.length - 1; i >= 0; i -= 1) {
    const message = safe[i];
    const cost = estimateTokens(message.content);
    if (historyTokens + cost > available) {
      // This message and every older one are dropped.
      for (let j = i; j >= 0; j -= 1) {
        dropped.push({ role: safe[j].role, reason: "budget" });
      }
      break;
    }
    historyTokens += cost;
    keptReversed.push(message);
  }

  const turns: PriorTurn[] = keptReversed.reverse().map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    text: message.content,
  }));

  return { turns, historyTokens, dropped };
}

export function hardenUserMessage(message: string): HardenedMessageResult {
  const withoutControlChars = message.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, " ");
  const normalizedWhitespace = withoutControlChars
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    value: normalizedWhitespace,
    wasModified: normalizedWhitespace !== message,
  };
}

export function detectPromptInjection(message: string): PromptInjectionAssessment {
  for (const { ruleId, pattern } of INJECTION_PATTERNS) {
    if (pattern.test(message)) {
      return { blocked: true, ruleId };
    }
  }

  return { blocked: false };
}

export function enforceToolAllowlist(
  toolCalls: GeminiToolCall[],
  maxTools: number = AI_TOOL_CALL_CAP,
): ToolAllowlistResult {
  const allowlist = new Set<string>(GEMINI_TOOL_NAMES);

  const allowedCalls: GeminiToolCall[] = [];
  const blockedCalls: GeminiToolCall[] = [];
  const droppedByCap: GeminiToolCall[] = [];

  for (const toolCall of toolCalls) {
    if (!allowlist.has(toolCall.name)) {
      blockedCalls.push(toolCall);
      continue;
    }

    if (allowedCalls.length >= maxTools) {
      droppedByCap.push(toolCall);
      continue;
    }

    allowedCalls.push(toolCall);
  }

  return {
    allowedCalls,
    blockedCalls,
    droppedByCap,
  };
}

export function deriveDataWindowFromToolCalls(
  toolCalls: GeminiToolCall[],
  now: Date = new Date(),
): DataWindow {
  const ranges: Array<{ start: Date; end: Date }> = [];

  for (const toolCall of toolCalls) {
    const toolRange = deriveToolRange(toolCall, now);
    if (toolRange) {
      ranges.push(toolRange);
    }
  }

  if (ranges.length === 0) {
    const today = formatDateOnly(now);
    return { start: today, end: today };
  }

  const minStart = new Date(
    Math.min(...ranges.map((range) => range.start.getTime())),
  );
  const maxEnd = new Date(Math.max(...ranges.map((range) => range.end.getTime())));

  return {
    start: formatDateOnly(minStart),
    end: formatDateOnly(maxEnd),
  };
}

function deriveToolRange(
  toolCall: GeminiToolCall,
  now: Date,
): { start: Date; end: Date } | null {
  const period = asString(toolCall.args.period);
  if (period) {
    const periodDays = periodToDays(period);
    if (periodDays !== null) {
      return {
        start: subtractDays(now, periodDays - 1),
        end: now,
      };
    }
  }

  const days = asPositiveInt(toolCall.args.days);
  if (days !== null) {
    return {
      start: subtractDays(now, days - 1),
      end: now,
    };
  }

  const months = asPositiveInt(toolCall.args.months);
  if (months !== null) {
    return {
      start: subtractMonthsStart(now, months - 1),
      end: now,
    };
  }

  const month = asString(toolCall.args.month);
  if (month) {
    const parsedMonth = parseMonth(month);
    if (parsedMonth) {
      return parsedMonth;
    }
  }

  const dateFrom = parseDate(asString(toolCall.args.dateFrom));
  const dateTo = parseDate(asString(toolCall.args.dateTo));
  if (dateFrom || dateTo) {
    return {
      start: dateFrom || dateTo || now,
      end: dateTo || dateFrom || now,
    };
  }

  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asPositiveInt(value: unknown): number | null {
  if (typeof value !== "number") {
    return null;
  }

  if (!Number.isInteger(value) || value <= 0) {
    return null;
  }

  return value;
}

function periodToDays(period: string): number | null {
  switch (period) {
    case "7d":
      return 7;
    case "30d":
      return 30;
    case "90d":
      return 90;
    case "12m":
      return 365;
    default:
      return null;
  }
}

function parseMonth(month: string): { start: Date; end: Date } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) {
    return null;
  }

  const year = Number.parseInt(match[1], 10);
  const monthIndex = Number.parseInt(match[2], 10) - 1;
  if (monthIndex < 0 || monthIndex > 11) {
    return null;
  }

  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 0));
  return { start, end };
}

function parseDate(value: string | null): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function subtractDays(date: Date, days: number): Date {
  const value = new Date(date);
  value.setUTCDate(value.getUTCDate() - days);
  return value;
}

function subtractMonthsStart(date: Date, months: number): Date {
  const value = new Date(date);
  value.setUTCDate(1);
  value.setUTCMonth(value.getUTCMonth() - months);
  return value;
}

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}
