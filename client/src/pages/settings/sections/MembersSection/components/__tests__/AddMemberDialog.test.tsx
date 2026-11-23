import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AddMemberDialog } from "../AddMemberDialog";

// AH-05: Add Member sends an email invitation (POST /api/household/invite).
const { mockMutate } = vi.hoisted(() => ({ mockMutate: vi.fn() }));
vi.mock("@/hooks/use-household-membership", () => ({
  useInviteMember: () => ({
    mutate: mockMutate,
    isPending: false,
  }),
}));

async function openDialog(canInviteAdmin = true) {
  const user = userEvent.setup();
  render(<AddMemberDialog canInviteAdmin={canInviteAdmin} />);
  await user.click(screen.getByText("Add Member"));
  return user;
}

async function openRoleOptions(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByLabelText("Select role for new member"));
  // Radix Select renders the selected value in the trigger AND the matching
  // option in the listbox portal; scope to the listbox to query options.
  return within(screen.getByRole("listbox"));
}

describe("AddMemberDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders trigger button by default", () => {
    render(<AddMemberDialog canInviteAdmin />);

    expect(screen.getByText("Add Member")).toBeInTheDocument();
  });

  it("explains that the person is invited by email", async () => {
    await openDialog();

    expect(screen.getByText("Invite a household member")).toBeInTheDocument();
    expect(screen.getByText(/We'll email them an invitation/)).toBeInTheDocument();
    expect(screen.getByLabelText("Email address")).toBeInTheDocument();
  });

  it("offers every invitable role to the owner, with Professional as read-only (AH-13)", async () => {
    const user = await openDialog(true);
    const listbox = await openRoleOptions(user);

    expect(listbox.getByText(/Admin - Can manage members/)).toBeInTheDocument();
    expect(listbox.getByText(/Member - Can add\/edit/)).toBeInTheDocument();
    expect(listbox.getByText(/View Only - Read-only/)).toBeInTheDocument();
    expect(listbox.getByText(/Professional - Read-only access for an outside adviser/)).toBeInTheDocument();
    expect(listbox.queryByText(/Owner/)).not.toBeInTheDocument();
  });

  it("does not offer admin to an admin (spec §A3)", async () => {
    const user = await openDialog(false);
    const listbox = await openRoleOptions(user);

    expect(listbox.queryByText(/Admin - Can manage members/)).not.toBeInTheDocument();
    expect(listbox.getByText(/Professional - Read-only access for an outside adviser/)).toBeInTheDocument();
  });

  it("disables the send button until an email is entered", async () => {
    const user = await openDialog();
    const sendButton = screen.getByRole("button", { name: "Send invitation" });
    expect(sendButton).toBeDisabled();

    await user.type(screen.getByLabelText("Email address"), "test@example.com");
    expect(sendButton).not.toBeDisabled();
  });

  it("sends the invite request shape the server accepts", async () => {
    const user = await openDialog();
    await user.type(screen.getByLabelText("Email address"), "  partner@example.com ");
    await user.click(screen.getByRole("button", { name: "Send invitation" }));

    expect(mockMutate).toHaveBeenCalledWith(
      { email: "partner@example.com", role: "member" },
      expect.anything(),
    );
  });

  it("renders custom trigger when provided", () => {
    render(
      <AddMemberDialog canInviteAdmin>
        <button>Custom Trigger</button>
      </AddMemberDialog>
    );

    expect(screen.getByText("Custom Trigger")).toBeInTheDocument();
    expect(screen.queryByText("Add Member")).not.toBeInTheDocument();
  });
});
