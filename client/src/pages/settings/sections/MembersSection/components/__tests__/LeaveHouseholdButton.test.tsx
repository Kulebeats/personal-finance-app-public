import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LeaveHouseholdButton } from "../LeaveHouseholdButton";

// AH-05: the members screen has a caller for POST /api/household/leave.
const { mockLeave } = vi.hoisted(() => ({ mockLeave: { mutate: vi.fn(), isPending: false } }));
vi.mock("@/hooks/use-household-membership", () => ({
  useLeaveHousehold: () => mockLeave,
}));

describe("LeaveHouseholdButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lets a non-owner leave after confirming", async () => {
    const user = userEvent.setup();
    render(<LeaveHouseholdButton currentUserRole="member" />);

    await user.click(screen.getByRole("button", { name: "Leave household" }));
    expect(await screen.findByText(/You will lose access to this household/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Leave" }));

    expect(mockLeave.mutate).toHaveBeenCalledTimes(1);
  });

  it("does nothing until the leave is confirmed", async () => {
    const user = userEvent.setup();
    render(<LeaveHouseholdButton currentUserRole="view_only" />);

    await user.click(screen.getByRole("button", { name: "Leave household" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(mockLeave.mutate).not.toHaveBeenCalled();
  });

  it("tells the owner to transfer ownership first instead of offering to leave", () => {
    render(<LeaveHouseholdButton currentUserRole="owner" />);

    expect(screen.queryByRole("button", { name: "Leave household" })).not.toBeInTheDocument();
    expect(screen.getByText(/Transfer ownership to another member before you can leave/)).toBeInTheDocument();
  });

  it("renders nothing before the role is known", () => {
    const { container } = render(<LeaveHouseholdButton currentUserRole={undefined} />);

    expect(container).toBeEmptyDOMElement();
  });
});
