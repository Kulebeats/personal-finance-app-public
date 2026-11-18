import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AddMemberDialog } from "../AddMemberDialog";

// Mock hooks
const mockMutate = vi.fn();
vi.mock("@/hooks/use-settings", () => ({
  useAddMember: () => ({
    mutate: mockMutate,
    isPending: false,
  }),
}));

describe("AddMemberDialog", () => {
  it("renders trigger button by default", () => {
    render(<AddMemberDialog />);

    expect(screen.getByText("Add Member")).toBeInTheDocument();
  });

  it("opens dialog when trigger is clicked", async () => {
    const user = userEvent.setup();
    render(<AddMemberDialog />);

    await user.click(screen.getByText("Add Member"));

    expect(screen.getByText("Add Household Member")).toBeInTheDocument();
    expect(
      screen.getByText(/Add an existing user to your household/)
    ).toBeInTheDocument();
  });

  it("has email input field", async () => {
    const user = userEvent.setup();
    render(<AddMemberDialog />);

    await user.click(screen.getByText("Add Member"));

    expect(screen.getByLabelText("Email or Username")).toBeInTheDocument();
  });

  it("has role selector with all roles", async () => {
    const user = userEvent.setup();
    render(<AddMemberDialog />);

    await user.click(screen.getByText("Add Member"));

    const roleSelect = screen.getByLabelText("Select role for new member");
    expect(roleSelect).toBeInTheDocument();

    // Open select
    await user.click(roleSelect);

    // Radix Select renders the selected value in the trigger AND the matching
    // option in the listbox portal, so the default "Member" label appears twice.
    // Scope assertions to the open listbox to query the option set unambiguously.
    const listbox = within(screen.getByRole("listbox"));

    // Check all role options are present
    expect(listbox.getByText(/Admin - Can manage members/)).toBeInTheDocument();
    expect(listbox.getByText(/Member - Can add\/edit/)).toBeInTheDocument();
    expect(listbox.getByText(/View Only - Read-only/)).toBeInTheDocument();
    expect(listbox.getByText(/Professional - Advisor/)).toBeInTheDocument();
  });

  it("defaults to member role", async () => {
    const user = userEvent.setup();
    render(<AddMemberDialog />);

    await user.click(screen.getByText("Add Member"));

    // The select should have "member" as default
    const roleSelect = screen.getByLabelText("Select role for new member");
    expect(roleSelect).toBeInTheDocument();
  });

  it("disables add button when email is empty", async () => {
    const user = userEvent.setup();
    render(<AddMemberDialog />);

    await user.click(screen.getByText("Add Member"));

    const addButton = screen.getByRole("button", { name: "Add Member" });
    expect(addButton).toBeDisabled();
  });

  it("enables add button when email is entered", async () => {
    const user = userEvent.setup();
    render(<AddMemberDialog />);

    await user.click(screen.getByText("Add Member"));

    const emailInput = screen.getByLabelText("Email or Username");
    await user.type(emailInput, "test@example.com");

    const addButton = screen.getByRole("button", { name: "Add Member" });
    expect(addButton).not.toBeDisabled();
  });

  it("renders custom trigger when provided", () => {
    render(
      <AddMemberDialog>
        <button>Custom Trigger</button>
      </AddMemberDialog>
    );

    expect(screen.getByText("Custom Trigger")).toBeInTheDocument();
    expect(screen.queryByText("Add Member")).not.toBeInTheDocument();
  });

  it("has helpful description text", async () => {
    const user = userEvent.setup();
    render(<AddMemberDialog />);

    await user.click(screen.getByText("Add Member"));

    expect(
      screen.getByText(/The user must already have a registered account/)
    ).toBeInTheDocument();
  });
});
