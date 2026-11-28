import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DeleteAccountCard } from "../DeleteAccountCard";

// AH-08 (d): the settings screen has a caller for POST /api/settings/account/delete.
const { erase, forget } = vi.hoisted(() => ({
  erase: { mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false, error: null as unknown },
  forget: vi.fn(),
}));
vi.mock("@/hooks/useAccountErasure", () => ({
  useAccountErasure: () => erase,
  useForgetErasurePassword: () => forget,
}));

async function openDialog() {
  const user = userEvent.setup();
  render(<DeleteAccountCard />);
  await user.click(screen.getByRole("button", { name: "Delete my account" }));
  return user;
}

describe("DeleteAccountCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(erase, { isPending: false, isError: false, error: null });
  });

  it("states what erasure deletes and that it cannot be undone", () => {
    render(<DeleteAccountCard />);

    expect(screen.getByText(/only member of your household, the household and all of its financial records are deleted/)).toBeInTheDocument();
    expect(screen.getByText(/ownership passes to the most senior remaining member/)).toBeInTheDocument();
    expect(screen.getByText(/This cannot be undone/)).toBeInTheDocument();
  });

  it("erases only with the password and the typed confirmation", async () => {
    const user = await openDialog();
    const submit = screen.getByRole("button", { name: "Permanently delete account" });

    await user.type(screen.getByLabelText("Current password"), "Synthetic-Password-1");
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText("Type DELETE to confirm"), "delete");
    expect(submit).toBeDisabled();
    await user.clear(screen.getByLabelText("Type DELETE to confirm"));
    await user.type(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
    await user.click(submit);

    expect(erase.mutate).toHaveBeenCalledWith("Synthetic-Password-1");
  });

  it("keeps the account and forgets the password when the person backs out", async () => {
    const user = await openDialog();
    await user.type(screen.getByLabelText("Current password"), "Synthetic-Password-1");

    await user.click(screen.getByRole("button", { name: "Keep my account" }));

    expect(erase.mutate).not.toHaveBeenCalled();
    expect(forget).toHaveBeenCalled();
    expect(screen.queryByLabelText("Current password")).not.toBeInTheDocument();
  });

  it("says the account was not deleted when the password is wrong", async () => {
    Object.assign(erase, { isError: true, error: Object.assign(new Error("Password is incorrect"), { code: "INVALID_CREDENTIALS", status: 401 }) });

    await openDialog();

    expect(screen.getByRole("alert")).toHaveTextContent("Your account was not deleted. The password is incorrect.");
  });
});
