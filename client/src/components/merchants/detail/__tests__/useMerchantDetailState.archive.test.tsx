/**
 * @vitest-environment jsdom
 *
 * NEW-37: the detail view's confirm dialog asks first, so the hook's archive
 * action runs the archive (a soft delete) once, without the native confirm box.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMerchantDetailState } from "../useMerchantDetailState";

const deleteMerchant = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false }));
const query = vi.hoisted(() => () => ({ data: undefined }));
const mutation = vi.hoisted(() => () => ({ mutate: vi.fn(), isPending: false }));

vi.mock("@/hooks/use-settings", () => ({
  useCategories: query,
  useMerchantDetails: () => ({ data: { merchant: { id: "m1", name: "Synthetic Grocer" }, aliases: [] } }),
  useMerchantAnalytics: query,
  useMerchantTransactions: query,
  useAddMerchantAlias: mutation,
  useDeleteMerchantAlias: mutation,
  useDeleteMerchant: () => deleteMerchant,
}));
vi.mock("@/hooks/use-reports", () => ({
  useReportsSpendingBreakdown: query,
  requestReportExport: vi.fn(),
  getReportsExportDownloadUrl: vi.fn(),
}));

afterEach(() => vi.restoreAllMocks());

describe("useMerchantDetailState archive", () => {
  it("archives (soft delete) once without the native confirm box", () => {
    const nativeConfirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const onClose = vi.fn();
    const { result } = renderHook(() => useMerchantDetailState("m1"));

    act(() => result.current.actions.handleDeleteMerchant(onClose));

    expect(nativeConfirm).not.toHaveBeenCalled();
    expect(deleteMerchant.mutate).toHaveBeenCalledTimes(1);
    expect(deleteMerchant.mutate).toHaveBeenCalledWith(
      { id: "m1", options: { action: "soft" } }, expect.anything(),
    );
  });
});
