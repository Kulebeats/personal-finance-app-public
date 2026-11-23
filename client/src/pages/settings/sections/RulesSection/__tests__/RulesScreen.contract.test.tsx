/**
 * @vitest-environment jsdom
 *
 * Rules screen against the real server shapes (Rule 18). Server shapes are
 * copied from server/modules/rules/rules.controller.ts and
 * server/services/rule/tag-references.ts.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PreviewTab } from "../components/PreviewTab";
import { ActionCard } from "../components/ActionCard";
import { QuickRuleActionBuilder } from "../components/QuickRuleActionBuilder";
import { RuleCard } from "../RuleCard";
import { QuickRuleBuilder } from "../components/QuickRuleBuilder";
import { RuleEditorModal } from "../RuleEditorModal";
import { getDefaultAction } from "../constants";
import { RULE_PREVIEW_LIMIT, type Rule } from "@/hooks/use-settings";

const TAG_FOOD = "6f1c1f4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const TAG_TRAVEL = "7a2d2a5f-2b3c-4d4e-9f0a-1b2c3d4e5f60";
const CATEGORY_ID = "b3912c17-5f6e-4a1b-9c2d-3e4f5a6b7c8d";

vi.mock("@/hooks", () => ({
  useTags: vi.fn(() => ({
    data: [
      { id: "6f1c1f4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f", name: "Food", color: "#FF5733", householdId: "h1", usageCount: 5 },
      { id: "7a2d2a5f-2b3c-4d4e-9f0a-1b2c3d4e5f60", name: "Travel", color: "#33FF57", householdId: "h1", usageCount: 3 },
    ],
    isLoading: false,
    error: null,
  })),
  useCreateTag: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useUpdateTag: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useDeleteTag: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// OwnerSelector is not under test and pulls in unrelated queries.
vi.mock("@/components/OwnerSelector", () => ({ OwnerSelector: () => null }));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

describe("PreviewTab with the server preview response", () => {
  it("lists matchingTransactions and reports count / totalChecked", () => {
    // rulesController.preview -> success(res, { matchingTransactions, count, totalChecked })
    const data = {
      matchingTransactions: [
        { id: "t1", date: "2026-11-10", name: "Shoprite Manda Hill", amount: "250.00", type: "expense", categoryId: null },
        { id: "t2", date: "2026-11-12", name: "Shoprite Levy", amount: "90.50", type: "expense", categoryId: null },
      ],
      count: 2,
      totalChecked: 200,
    };

    render(
      <PreviewTab
        enabledConditions={[{ type: "merchant_name", operator: "contains", value: "Shoprite", enabled: true }]}
        previewMutation={{ isPending: false, data }}
        categories={[]}
      />,
    );

    expect(screen.getByText("Shoprite Manda Hill")).toBeInTheDocument();
    expect(screen.getByText("Shoprite Levy")).toBeInTheDocument();
    expect(screen.getByText(/Found 2 matching transactions/)).toBeInTheDocument();
    expect(screen.getByText(/Scanned 200 recent/)).toBeInTheDocument();
  });

  it("marks a count at the server's limit as a lower bound", () => {
    // The server stops collecting at `limit`, so 20 matches means "20 or more".
    const matchingTransactions = Array.from({ length: RULE_PREVIEW_LIMIT }, (_, i) => ({
      id: `t${i}`,
      date: "2026-11-10",
      name: `Shoprite ${i}`,
      amount: "10.00",
      type: "expense",
      categoryId: null,
    }));

    render(
      <PreviewTab
        enabledConditions={[{ type: "merchant_name", operator: "contains", value: "Shoprite", enabled: true }]}
        previewMutation={{
          isPending: false,
          data: { matchingTransactions, count: RULE_PREVIEW_LIMIT, totalChecked: 200 },
        }}
        categories={[]}
      />,
    );

    expect(screen.getByText(/Found 20\+ matching transactions \(showing the first 20\)/)).toBeInTheDocument();
  });

  it("shows the empty state when the server finds no matches", () => {
    render(
      <PreviewTab
        enabledConditions={[{ type: "merchant_name", operator: "contains", value: "zzz", enabled: true }]}
        previewMutation={{ isPending: false, data: { matchingTransactions: [], count: 0, totalChecked: 200 } }}
        categories={[]}
      />,
    );

    expect(screen.getByText("No matches found")).toBeInTheDocument();
    expect(screen.getByText(/Scanned 200 recent transactions/)).toBeInTheDocument();
  });
});

describe("Add tags action picks existing tags", () => {
  beforeEach(() => vi.clearAllMocks());

  it("full editor: defaults to an empty id list and has no free-text box", () => {
    expect(getDefaultAction("add_tags").value).toEqual([]);

    render(
      <ActionCard
        action={getDefaultAction("add_tags")}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
        categories={[]}
        merchants={[]}
        goals={[]}
        members={[]}
      />,
      { wrapper },
    );

    expect(screen.queryByPlaceholderText(/comma separated/i)).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /select tags/i })).toBeInTheDocument();
  });

  it("full editor: a scalar tag id on a saved rule shows as selected and is kept", async () => {
    // validateRuleTagReferenceSets accepts add_tags as a single id string.
    const user = userEvent.setup();
    const onUpdate = vi.fn();

    render(
      <ActionCard
        action={{ ...getDefaultAction("add_tags"), value: TAG_FOOD }}
        onUpdate={onUpdate}
        onRemove={vi.fn()}
        categories={[]}
        merchants={[]}
        goals={[]}
        members={[]}
      />,
      { wrapper },
    );

    expect(screen.getByText("Food")).toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: /select tags/i }));
    await user.click(await screen.findByRole("option", { name: /Travel/ }));

    expect(onUpdate).toHaveBeenCalledWith({ value: [TAG_FOOD, TAG_TRAVEL] });
  });

  it("full editor: choosing a tag sends its id, the shape the server validates", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();

    render(
      <ActionCard
        action={{ ...getDefaultAction("add_tags"), value: [TAG_FOOD] }}
        onUpdate={onUpdate}
        onRemove={vi.fn()}
        categories={[]}
        merchants={[]}
        goals={[]}
        members={[]}
      />,
      { wrapper },
    );

    await user.click(screen.getByRole("combobox", { name: /select tags/i }));
    await user.click(await screen.findByRole("option", { name: /Travel/ }));

    expect(onUpdate).toHaveBeenCalledWith({ value: [TAG_FOOD, TAG_TRAVEL] });
  });

  it("quick rule: choosing a tag sends an id list for the add_tags action", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <QuickRuleActionBuilder
        action={{ type: "add_tags", value: [] }}
        categories={[]}
        merchants={[]}
        goals={[]}
        onChange={onChange}
      />,
      { wrapper },
    );

    expect(screen.queryByPlaceholderText("Value...")).not.toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: /select tags/i }));
    await user.click(await screen.findByRole("option", { name: /Food/ }));

    expect(onChange).toHaveBeenCalledWith({ type: "add_tags", value: [TAG_FOOD] });
  });
});

describe("Rule list chip", () => {
  const rule: Rule = {
    id: "rule-1",
    householdId: "h1",
    name: "Groceries",
    conditions: [{ type: "merchant_name", operator: "contains", value: "Shoprite", enabled: true }],
    conditionLogic: "all",
    actions: [{ type: "categorize", value: CATEGORY_ID, enabled: true }],
    enabled: true,
    applyToPast: false,
    priority: 0,
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
  };

  it("shows the category name, not the raw category id", () => {
    render(
      <RuleCard
        rule={rule}
        onToggle={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onTest={vi.fn()}
        categoryNamesById={new Map([[CATEGORY_ID, "Groceries & Food"]])}
      />,
    );

    expect(screen.getByText("Categorize: Groceries & Food")).toBeInTheDocument();
    expect(screen.queryByText(/b3912c17/)).not.toBeInTheDocument();
  });
});

describe("add_tags can never submit an empty or foreign id list", () => {
  it("quick rule: switching from a category to Add tags clears the category id and blocks Create", async () => {
    const user = userEvent.setup();
    const mutate = vi.fn();

    render(
      <QuickRuleBuilder
        createRule={{ isPending: false, mutate }}
        categories={[{ id: CATEGORY_ID, name: "Groceries" }]}
        merchants={[]}
        accounts={[]}
        goals={[]}
        onClose={vi.fn()}
      />,
      { wrapper },
    );

    await user.type(screen.getByLabelText(/rule name/i), "Shoprite");
    await user.type(screen.getByPlaceholderText("Value..."), "Shoprite");
    // The visible text is a pointer-events:none span; click the combobox trigger.
    await user.click(screen.getByText("Select category").closest("button")!);
    await user.click(await screen.findByRole("option", { name: "Groceries" }));
    await user.click(screen.getByText("Update category").closest("button")!);
    await user.click(await screen.findByRole("option", { name: "Add tags" }));

    // The picker starts empty: the category id was not carried over as a tag.
    expect(screen.getByRole("combobox", { name: /select tags/i })).toHaveTextContent("Select tags...");
    await user.click(screen.getByRole("button", { name: "Create Rule" }));

    expect(mutate).not.toHaveBeenCalled();
  });

  it("full editor: saving an Add tags action with no tag shows an error and sends nothing", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const rule: Rule = {
      id: "rule-1",
      householdId: "h1",
      name: "Tag it",
      conditions: [{ type: "merchant_name", operator: "contains", value: "Shoprite", enabled: true }],
      conditionLogic: "all",
      actions: [{ type: "add_tags", value: [], enabled: true }],
      enabled: true,
      applyToPast: false,
      priority: 0,
      createdAt: "2026-11-01T00:00:00Z",
      updatedAt: "2026-11-01T00:00:00Z",
    };

    // Pre-existing: the editor dialog has no Description (not part of this change).
    globalThis.expectConsoleMessage?.("warn", /Missing `Description`/);

    render(
      <RuleEditorModal
        open
        onOpenChange={vi.fn()}
        rule={rule}
        onSave={onSave}
        categories={[]}
        merchants={[]}
        accounts={[]}
        goals={[]}
        members={[]}
      />,
      { wrapper },
    );

    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/choose at least one tag/i);
  });
});
