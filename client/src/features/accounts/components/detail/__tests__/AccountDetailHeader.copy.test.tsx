import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountDetailHeader } from "../AccountDetailHeader";
import type { Account } from "@/lib/api";
import { activateOperationLifetime, createOperationLifetime, retireOperationLifetime } from "@/lib/operation-lifetime";

const mocks = vi.hoisted(() => ({ export: vi.fn(), toast: vi.fn(), download: vi.fn(), write: vi.fn() }));
vi.mock("@/lib/api", () => ({ accountsApi: { exportBalanceHistory: mocks.export } }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/hooks", () => ({
  useExportTransactions: () => ({ mutate: mocks.download, isPending: false }),
  useExportBalanceHistory: () => ({ mutate: mocks.download, isPending: false }),
}));

const csv = 'date,balance,currency\r\n2026-10-29,123.45,ZMW\r\n';
const blob = () => ({ text: async () => csv }) as Blob;
const account = { id: "account-a", name: "Everyday", type: "checking", balance: "123.45", currency: "ZMW" } as Account;
const props = { account, dateRange: "all" as const, setDateRange: vi.fn(), onEdit: vi.fn(), onImportTransactions: vi.fn(), onImportBalanceHistory: vi.fn(), hasHistory: true };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Edit" }));
  return screen.findByRole("menuitem", { name: /Copy balance history/ });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.export.mockResolvedValue(blob());
  mocks.write.mockResolvedValue(undefined);
  activateOperationLifetime(createOperationLifetime({ subject: "actor-a", household: "home-a" }));
});
afterEach(() => { cleanup(); retireOperationLifetime(); vi.restoreAllMocks(); });

describe("AccountDetailHeader copy balance history", () => {
  it("copies the authorized CSV unchanged and reports success only after the write", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: mocks.write } });
    const pending = deferred<void>();
    mocks.write.mockReturnValueOnce(pending.promise);
    render(<AccountDetailHeader {...props} />);
    await user.click(await openMenu(user));
    await waitFor(() => expect(mocks.write).toHaveBeenCalledWith(csv));
    expect(mocks.export).toHaveBeenCalledWith("account-a", expect.objectContaining({ active: true }));
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();
    await act(async () => pending.resolve());
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Balance history copied" }));
  });

  it.each(["export", "clipboard"])("reports %s failure and permits an explicit retry", async (failure) => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: mocks.write } });
    mocks[failure === "export" ? "export" : "write"].mockRejectedValueOnce(new Error("denied"));
    render(<AccountDetailHeader {...props} />);
    await user.click(await openMenu(user));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Copy failed", variant: "destructive" })));
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Balance history copied" }));
    await user.click(await openMenu(user));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Balance history copied" })));
    expect(mocks.write).toHaveBeenLastCalledWith(csv);
  });

  it("explains unavailable clipboard without fetching private CSV", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    render(<AccountDetailHeader {...props} />);
    await user.click(await openMenu(user));
    expect(mocks.export).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Copy failed", description: expect.stringContaining("Download balance history") }));
  });

  it("disables repeated copies while exporting", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: mocks.write } });
    const pending = deferred<Blob>();
    mocks.export.mockReturnValueOnce(pending.promise);
    render(<AccountDetailHeader {...props} />);
    await user.click(await openMenu(user));
    const item = await openMenu(user);
    expect(item).toHaveAttribute("aria-disabled", "true");
    await user.click(item);
    expect(mocks.export).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(blob()));
  });

  it.each(["account", "unmount", "session"])("does not copy after %s changes during export", async (change) => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: mocks.write } });
    const pending = deferred<Blob>();
    mocks.export.mockReturnValueOnce(pending.promise);
    const view = render(<AccountDetailHeader {...props} />);
    await user.click(await openMenu(user));
    if (change === "account") view.rerender(<AccountDetailHeader {...props} account={{ ...account, id: "account-b" }} />);
    if (change === "unmount") view.unmount();
    if (change === "session") activateOperationLifetime(createOperationLifetime({ subject: "actor-b", household: "home-b" }));
    await act(async () => pending.resolve(blob()));
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("fences session retirement during Blob decoding", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: mocks.write } });
    const pending = deferred<string>();
    const text = vi.fn(() => pending.promise);
    mocks.export.mockResolvedValueOnce({ text });
    render(<AccountDetailHeader {...props} />);
    await user.click(await openMenu(user));
    await waitFor(() => expect(text).toHaveBeenCalled());
    retireOperationLifetime();
    await act(async () => pending.resolve(csv));
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("suppresses a completion notification after an already dispatched write loses its session", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: mocks.write } });
    const pending = deferred<void>();
    mocks.write.mockReturnValueOnce(pending.promise);
    render(<AccountDetailHeader {...props} />);
    await user.click(await openMenu(user));
    await waitFor(() => expect(mocks.write).toHaveBeenCalled());
    retireOperationLifetime();
    await act(async () => pending.resolve());
    expect(mocks.toast).not.toHaveBeenCalled();
  });
});
