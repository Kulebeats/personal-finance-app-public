/**
 * @vitest-environment jsdom
 *
 * A-44 (owner ruling 21 Nov): the "Assign member" rule action is removed. It
 * never did anything (no executor). Settings no longer offers it, and a rule
 * saved before the removal shows the action as removed, not as a raw member id.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ACTION_TYPES } from "../constants";
import { ActionCard } from "../components/ActionCard";
import { RuleCard } from "../RuleCard";
import type { Rule, RuleAction } from "@/hooks/use-settings";

const MEMBER_ID = "5d0c3b9e-4a1f-4c2e-9b8d-7e6f5a4b3c2d";
// A rule stored before the removal: the type is no longer an ActionType.
const storedAction = { type: "assign_member", value: MEMBER_ID, enabled: true } as unknown as RuleAction;

vi.mock("@/components/OwnerSelector", () => ({ OwnerSelector: () => null }));

describe("Assign member rule action is removed (A-44)", () => {
  it("is not among the actions either rule editor offers", () => {
    // The full editor's "Add action" list and the quick builder both render ACTION_TYPES.
    const offered = ACTION_TYPES.map((type) => type.value as string);
    expect(offered).not.toContain("assign_member");
    expect(ACTION_TYPES.map((type) => type.label)).not.toContain("Assign member");
    expect(offered).toContain("set_owner");
  });

  it("a stored rule's chip says the action was removed and hides the member id", () => {
    const rule: Rule = {
      id: "rule-1", householdId: "h1", name: "Old rule",
      conditions: [{ type: "merchant_name", operator: "contains", value: "Shoprite", enabled: true }],
      conditionLogic: "all", actions: [storedAction], enabled: true, applyToPast: false, priority: 0,
      createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z",
    };

    render(<RuleCard rule={rule} onToggle={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onTest={vi.fn()} />);

    expect(screen.getByText("Assign member (removed)")).toBeInTheDocument();
    expect(screen.queryByText(/5d0c3b9e/)).not.toBeInTheDocument();
  });

  it("the editor names a stored action as removed, so it can be taken off the rule", () => {
    render(
      <ActionCard action={storedAction} onUpdate={vi.fn()} onRemove={vi.fn()} categories={[]} merchants={[]} goals={[]} members={[]} />,
    );

    expect(screen.getByText("Assign member (removed)")).toBeInTheDocument();
  });
});
