import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { AddGrzTBillModal } from "../AddGrzTBillModal";

// A-42: the maturity run pays a T-bill into its account, so the form must send one.
const { save, accountRows } = vi.hoisted(() => ({ save: vi.fn().mockResolvedValue({}), accountRows: [
  { id: "11111111-1111-4111-8111-111111111111", name: "Visible settlement", currency: "ZMW", isAsset: true, isArchived: false },
  { id: "22222222-2222-4222-8222-222222222222", name: "USD account", currency: "USD", isAsset: true, isArchived: false },
  { id: "33333333-3333-4333-8333-333333333333", name: "Archived account", currency: "ZMW", isAsset: true, isArchived: true },
  { id: "44444444-4444-4444-8444-444444444444", name: "Debt account", currency: "ZMW", isAsset: false, isArchived: false },
] }));
vi.mock("@/hooks/useGrzSecurities", () => ({ useCreateGrzTBill: () => ({ mutateAsync: save, isPending: false }) }));
vi.mock("@/hooks/useAccounts", () => ({ useAccounts: () => ({ data: accountRows, isLoading: false, isError: false }) }));
beforeEach(() => save.mockClear());

function fillTerms() {
  const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fill("T-Bill Name", "GRZ 91-Day");
  fill("Face Value (ZMW)", "1000");
  fill("Purchase Cost", "970");
}

it("R1-06: says the maturity is credited only once the member confirms the receipt", async () => {
  render(<AddGrzTBillModal open><button>Record</button></AddGrzTBillModal>);
  expect(await screen.findByText(/confirm the receipt/)).toBeVisible();
  expect(screen.queryByText(/is paid into this account at maturity/)).not.toBeInTheDocument();
});

it("A-42: refuses to record a T-bill until a settlement account is chosen", async () => {
  render(<AddGrzTBillModal open><button>Record</button></AddGrzTBillModal>);
  fillTerms();
  fireEvent.click(screen.getByRole("button", { name: "Add T-Bill" }));
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Settlement account" })).toHaveAttribute("aria-invalid", "true"));
  expect(save).not.toHaveBeenCalled();
});

it("A-42: sends the chosen visible ZMW asset account with the T-bill", async () => {
  const user = userEvent.setup();
  render(<AddGrzTBillModal open><button>Record</button></AddGrzTBillModal>);
  fillTerms();
  await user.click(screen.getByRole("combobox", { name: "Settlement account" }));
  for (const name of ["USD account (ZMW)", "Archived account (ZMW)", "Debt account (ZMW)"]) {
    expect(screen.queryByRole("option", { name })).not.toBeInTheDocument();
  }
  await user.click(screen.getByRole("option", { name: "Visible settlement (ZMW)" }));
  await user.click(screen.getByRole("button", { name: "Add T-Bill" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({
    accountId: accountRows[0].id, faceValue: "1000", purchasePrice: "970",
  })));
  expect(save).toHaveBeenCalledOnce();
});
