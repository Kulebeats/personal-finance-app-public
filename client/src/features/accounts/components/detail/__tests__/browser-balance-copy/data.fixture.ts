export const csv = "date,balance,currency\r\n2026-10-29,123.45,ZMW\r\n";
export const state = { exports: 0, fail: false, hold: false, release: null as null | (() => void) };
export const accountsApi = {
  async exportBalanceHistory() {
    state.exports++;
    if (state.hold) await new Promise<void>(resolve => { state.release = resolve; });
    if (state.fail) throw new Error("Synthetic export failure");
    return new Blob([csv], { type: "text/csv" });
  },
};
export function useExportTransactions() { return { mutate() {}, isPending: false }; }
export function useExportBalanceHistory() { return { mutate() {}, isPending: false }; }
export function useToast() {
  return { toast(value: { title: string; description?: string }) {
    window.dispatchEvent(new CustomEvent("copy-fixture-toast", { detail: value.title }));
  } };
}
