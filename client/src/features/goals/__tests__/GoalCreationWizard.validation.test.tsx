import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoalCreationWizard } from "../components/GoalCreationWizard";

const mocks = vi.hoisted(() => ({ create: vi.fn(), assign: vi.fn(), close: vi.fn(), pending: false,
  accounts: [] as Array<{ id: string; name: string; type: string; currency: string; balance: string }> }));
vi.mock("@/hooks/useAccounts", () => ({ useAccounts: () => ({ data: mocks.accounts, isLoading: false }) }));
vi.mock("@/hooks/useGoals", () => ({
  useCreateGoal: () => ({ mutate: mocks.create, mutateAsync: mocks.create, isPending: mocks.pending }),
  useAssignAccountForGoal: () => ({ mutateAsync: mocks.assign }),
  useAvailableFunds: () => ({ data: [] }),
}));
vi.mock("@/contexts/SettingsContext", () => ({ useFormatters: () => ({ currency: "ZMW", formatCurrency: (value: number) => `K${value}` }) }));
vi.mock("../components/GoalImagePicker", () => ({ GoalImagePicker: () => null }));
beforeEach(() => { vi.clearAllMocks(); mocks.pending = false; mocks.accounts = []; mocks.create.mockResolvedValue({ id: "created-goal" }); });
afterEach(cleanup);

describe("Goal creation required-field feedback", () => {
  it("announces why Continue cannot proceed and links to the missing inputs", async () => {
    const user = userEvent.setup();
    render(<GoalCreationWizard open onClose={mocks.close} />);
    screen.getByRole("button", { name: "Continue" }).focus();
    await user.keyboard("{Enter}");
    const summary = screen.getByRole("alert");
    expect(summary).toHaveTextContent("Enter a goal name");
    expect(summary).toHaveTextContent("Enter a target amount");
    expect(summary).toHaveTextContent("Specify the goal type");
    expect(summary).toHaveFocus();
    const name = screen.getByLabelText("Goal name");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription("Enter a goal name");
    screen.getByRole("link", { name: "Enter a goal name" }).focus();
    await user.keyboard("{Enter}");
    expect(name).toHaveFocus();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.assign).not.toHaveBeenCalled();
  });

  it("removes corrected errors and advances without losing entered details", async () => {
    const user = userEvent.setup();
    render(<GoalCreationWizard open onClose={mocks.close} />);
    await user.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(screen.getByLabelText("Goal name"), { target: { value: "Family holiday" } });
    expect(screen.getByLabelText("Goal name")).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText("Enter a goal name")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Please specify"), { target: { value: "Trip" } });
    fireEvent.change(screen.getByLabelText("Target amount"), { target: { value: "123.45" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(mocks.create).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Create goal" }));
    await waitFor(() => expect(mocks.close).toHaveBeenCalledTimes(1));
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ type: "save_up", name: "Family holiday", goalType: "Trip", targetAmount: { amount: "123.45", currency: "ZMW" } }));
    expect(mocks.assign).not.toHaveBeenCalled();
  });

  it("announces all missing pay-down fields and associates the debt selector", async () => {
    const user = userEvent.setup();
    render(<GoalCreationWizard open initialType="pay_down" onClose={mocks.close} />);
    await user.click(screen.getByRole("button", { name: "Create goal" }));
    for (const message of ["Enter a goal name", "Select a debt account", "Enter an interest rate", "Enter a minimum payment", "Enter a monthly payment"]) {
      expect(screen.getByRole("alert")).toHaveTextContent(message);
    }
    expect(screen.getByLabelText("Debt account")).toHaveAccessibleDescription("Select a debt account");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("accepts explicitly entered zero interest and minimum payment without inventing defaults", async () => {
    const user = userEvent.setup();
    mocks.accounts = [{ id: "debt-a", name: "Loan account", type: "loan", currency: "ZMW", balance: "-200" }];
    render(<GoalCreationWizard open initialType="pay_down" onClose={mocks.close} />);
    fireEvent.change(screen.getByLabelText("Goal name"), { target: { value: "Loan payoff" } });
    await user.click(screen.getByLabelText("Debt account"));
    await user.click(screen.getByRole("option", { name: "Loan account" }));
    fireEvent.change(screen.getByLabelText("Interest rate (%)"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Minimum payment"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Monthly payment"), { target: { value: "25" } });
    await user.click(screen.getByRole("button", { name: "Create goal" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ type: "pay_down", interestRate: "0", minimumPayment: { amount: "0", currency: "ZMW" }, monthlyPayment: { amount: "25", currency: "ZMW" } }), expect.any(Object));
  });

  it("reports investment requirements and submits corrected fields", async () => {
    const user = userEvent.setup();
    render(<GoalCreationWizard open initialType="investment" onClose={mocks.close} />);
    await user.click(screen.getByRole("button", { name: "Create goal" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a target amount");
    expect(screen.getByLabelText("Target amount")).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(screen.getByLabelText("Goal name"), { target: { value: "Invest" } });
    fireEvent.change(screen.getByLabelText("Target amount"), { target: { value: "500" } });
    await user.click(screen.getByRole("button", { name: "Create goal" }));
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ type: "investment", name: "Invest", targetAmount: { amount: "500", currency: "ZMW" } }), expect.any(Object));
  });

  it("clears validation on type changes and on close/reopen", async () => {
    const user = userEvent.setup();
    const view = render(<GoalCreationWizard open onClose={mocks.close} />);
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("tab", { name: "Investment" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create goal" }));
    expect(screen.getByRole("alert")).toHaveFocus();
    view.rerender(<GoalCreationWizard open={false} onClose={mocks.close} />);
    view.rerender(<GoalCreationWizard open onClose={mocks.close} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Goal name")).toHaveValue("");
  });

  it("keeps submission disabled while the existing mutation is pending", () => {
    mocks.pending = true;
    render(<GoalCreationWizard open onClose={mocks.close} />);
    expect(screen.getByRole("button", { name: "Creating..." })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Creating..." }));
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
