/**
 * AI Eval Pack - Unit Tests
 *
 * @module ai/__tests__/ai.eval-pack.test
 */

import { describe, expect, it } from "vitest";
import { runAIEvalPack } from "../ai.eval-pack";

describe("ai.eval-pack", () => {
  it("should pass all baseline eval checks", () => {
    const report = runAIEvalPack();
    expect(report.passed).toBe(true);
    expect(report.passRate).toBeGreaterThanOrEqual(report.requiredPassRate);
    expect(report.passedChecks).toBe(report.totalChecks);
  });
});
