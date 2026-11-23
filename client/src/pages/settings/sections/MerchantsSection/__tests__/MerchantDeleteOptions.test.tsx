/**
 * @vitest-environment jsdom
 *
 * The merchant delete options shown in settings must match what the server
 * does (ORG-007): archive keeps transactions, aliases and logo; merge moves the
 * transactions through the merge endpoint, which records an undo; permanent
 * delete is not offered while it has no retention policy (OI-04).
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MerchantDeleteSection } from "../components/MerchantDeleteSection";
import { useMerchantHandlers } from "../hooks/useMerchantHandlers";
import type { MerchantsSectionState } from "../hooks/useMerchantsSectionState";

const editingMerchant = { id: "m1", name: "Synthetic Grocer" };
const target = { id: "m2", name: "Synthetic Target" };

function sectionState(deleteAction: string): MerchantsSectionState {
  const state = {
    state: { editingMerchant, deleteAction, mergeTarget: "", deleteAcknowledged: false },
    derived: { deleteTransactionCount: 3, mergeCandidates: [target] },
    actions: {
      setDeleteAction: vi.fn(), setMergeTarget: vi.fn(),
      setDeleteAcknowledged: vi.fn(),
    },
  };
  return state as unknown as MerchantsSectionState;
}

type HandlerParams = Parameters<typeof useMerchantHandlers>[0];

function handlersFor(deleteAction: string, mergeTarget = "") {
  const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn() });
  const mutations = {
    updateMerchant: mutation(), createMerchant: mutation(), mergeMerchants: mutation(),
    deleteMerchant: mutation(), addMerchantAlias: mutation(), uploadMerchantLogo: mutation(),
    deleteMerchantLogo: mutation(),
  };
  const formDialog = {
    state: { editingMerchant, deleteAction, mergeTarget, deleteAcknowledged: true },
    actions: { setDialogOpen: vi.fn(), setEditingMerchant: vi.fn(), setMergeTarget: vi.fn() },
  };
  const params = {
    formDialog, mutations, mergePreview: {}, bulkActions: {}, merchants: [],
    mergeSource: null, setMergeSource: vi.fn(), setIsApplyingLogoPresets: vi.fn(),
  } as unknown as HandlerParams;
  return { handlers: useMerchantHandlers(params), mutations };
}

describe("merchant delete options", () => {
  it("offers exactly archive and merge, never permanent delete", async () => {
    const user = userEvent.setup();
    render(<MerchantDeleteSection state={sectionState("soft")} />);

    await user.click(screen.getByRole("combobox"));
    const options = screen.getAllByRole("option").map((option) => option.textContent ?? "");

    expect(options).toHaveLength(2);
    expect(options[0]).toMatch(/^archive/i);
    expect(options[1]).toMatch(/^merge/i);
    expect(options.join(" ")).not.toMatch(/permanent/i);
  });

  it("describes archive as keeping transactions, aliases and logo", () => {
    render(<MerchantDeleteSection state={sectionState("soft")} />);

    const description = screen.getByText(/keeps its .*transactions/i);
    expect(description.textContent).toMatch(/aliases/i);
    expect(description.textContent).toMatch(/logo/i);
    expect(screen.queryByPlaceholderText("DELETE")).not.toBeInTheDocument();
  });

  it("describes merge as undoable from merge history", () => {
    render(<MerchantDeleteSection state={sectionState("merge")} />);

    expect(screen.getByText(/moves .*transactions/i).textContent).toMatch(/undo/i);
  });

  it("sends archive to the delete endpoint as a soft delete", () => {
    const { handlers, mutations } = handlersFor("soft");

    handlers.handleDeleteMerchant();

    expect(mutations.deleteMerchant.mutate).toHaveBeenCalledWith(
      { id: "m1", options: { action: "soft" } }, expect.anything(),
    );
    expect(mutations.mergeMerchants.mutate).not.toHaveBeenCalled();
  });

  it("sends merge to the merge endpoint so it records an undo", () => {
    const { handlers, mutations } = handlersFor("merge", "m2");

    handlers.handleDeleteMerchant();

    expect(mutations.mergeMerchants.mutate).toHaveBeenCalledWith(
      { sourceId: "m1", targetId: "m2" }, expect.anything(),
    );
    expect(mutations.deleteMerchant.mutate).not.toHaveBeenCalled();
  });
});
