import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { AddGrzBondModal } from "../AddGrzBondModal";

const { save, accountRows } = vi.hoisted(() => ({ save: vi.fn().mockResolvedValue({}), accountRows: [
  { id: "11111111-1111-4111-8111-111111111111", name: "Visible custody", currency: "ZMW", isAsset: true, isArchived: false },
  { id: "22222222-2222-4222-8222-222222222222", name: "USD account", currency: "USD", isAsset: true, isArchived: false },
  { id: "33333333-3333-4333-8333-333333333333", name: "Archived account", currency: "ZMW", isAsset: true, isArchived: true },
  { id: "44444444-4444-4444-8444-444444444444", name: "Debt account", currency: "ZMW", isAsset: false, isArchived: false },
] }));
vi.mock("@/hooks/useGrzSecurities", () => ({ useCreateGrzBond: () => ({ mutateAsync: save }) }));
vi.mock("@/hooks/useAccounts", () => ({ useAccounts: () => ({ data: accountRows, isLoading: false, isError: false }) }));
beforeEach(() => save.mockClear());

it("records a reopened bond using the investor's price, coupon and issue dates", async () => {
  render(<AddGrzBondModal open><button>Record</button></AddGrzBondModal>);
  const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fill("Bond Name", "Reopened GRZ");
  fill("Purchase Price (ZMW)", "950");
  fill("Face Value (ZMW)", "1000");
  fill("Maturity Date", "2029-05-10");
  fill("First coupon date you are entitled to", "2027-05-10");
  fill("Purchase Date", "2027-03-12");
  fireEvent.click(screen.getByRole("button", { name: "Add Bond" }));
  await waitFor(() => expect(screen.getByLabelText("Coupon Rate (%)")).toHaveAttribute("aria-invalid", "true"));
  expect(save).not.toHaveBeenCalled();
  fill("Coupon Rate (%)", "18.99");
  fireEvent.click(screen.getByRole("button", { name: "Add Bond" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({
    faceValue: "1000", purchasePrice: "950", couponRate: "0.1899", firstCouponDate: "2027-05-10",
    purchaseDate: "2027-03-12", maturityDate: "2029-05-10",
  })));
  expect(save.mock.calls[0][0]).not.toHaveProperty("accountId");
});

it("submits the explicitly selected visible ZMW custody account without treating it as purchase funding", async () => {
  const user = userEvent.setup(); render(<AddGrzBondModal open><button>Record</button></AddGrzBondModal>);
  const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fill("Bond Name", "Custody-linked GRZ"); fill("Purchase Price (ZMW)", "950"); fill("Face Value (ZMW)", "1000");
  fill("Maturity Date", "2029-05-10"); fill("First coupon date you are entitled to", "2026-05-10"); fill("Purchase Date", "2026-03-12"); fill("Coupon Rate (%)", "18.99");
  expect(screen.getByText(/does not deduct the purchase price/i)).toBeVisible();
  await user.click(screen.getByRole("combobox", { name: "Custody account (optional)" }));
  expect(screen.getByRole("option", { name: "No custody account" })).toBeVisible();
  for (const name of ["USD account", "Archived account", "Debt account"]) expect(screen.queryByRole("option", { name })).not.toBeInTheDocument();
  await user.click(screen.getByRole("option", { name: "Visible custody (ZMW)" }));
  await user.click(screen.getByRole("button", { name: "Add Bond" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ accountId: accountRows[0].id, purchasePrice: "950", faceValue: "1000", couponRate: "0.1899" })));
  expect(save).toHaveBeenCalledOnce();
});
