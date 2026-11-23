/**
 * Staging follow-up (21 Nov): the assistant is Thandi, and writes like a warm,
 * conversational guide that formats for the chat (which renders Markdown).
 */
import { describe, expect, it } from "vitest";
import { buildAnswerPrompt, buildSystemPrompt } from "../ai.tool-definitions";

describe("the assistant is Thandi", () => {
  it("the system prompt names Thandi, never Thandiso", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("You are Thandi,");
    expect(prompt).not.toContain("Thandiso");
  });

  it("tells the provider to refer to accounts by their labels, so the asker sees their own names", () => {
    expect(buildSystemPrompt()).toMatch(/label/i);
  });

  it("asks for a conversational answer that guides the user instead of a flat refusal", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toMatch(/conversational/i);
    expect(prompt).toMatch(/where in the app/i);
    expect(buildAnswerPrompt("q", [], "ZMW")).not.toMatch(/Be concise but complete\.$/);
  });
});
