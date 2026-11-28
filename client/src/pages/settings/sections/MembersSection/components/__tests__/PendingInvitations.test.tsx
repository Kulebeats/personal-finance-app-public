import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PendingInvitations } from "../PendingInvitations";
import type { PendingInvitation } from "@/hooks/use-household-invitations";

// AH-05: the members screen has callers for GET /api/household/invitations,
// POST /api/household/invitations/:id/resend and DELETE /api/household/invitations/:id.
const { state, mockResend, mockRevoke, mockQuery } = vi.hoisted(() => ({
  state: {
    query: { isLoading: false, isError: false, error: null as Error | null, data: [] as PendingInvitation[] },
  },
  mockResend: { mutate: vi.fn(), isPending: false },
  mockRevoke: { mutate: vi.fn(), isPending: false },
  mockQuery: vi.fn(),
}));
vi.mock("@/hooks/use-household-invitations", () => ({
  usePendingInvitations: (isEnabled: boolean) => {
    mockQuery(isEnabled);
    return { ...state.query, refetch: vi.fn() };
  },
  useResendInvitation: () => mockResend,
  useRevokeInvitation: () => mockRevoke,
}));

const INVITE: PendingInvitation = {
  id: "inv-1",
  email: "guest@example.test",
  role: "view_only",
  invitedBy: "user-1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  createdAt: "2026-11-28T00:00:00.000Z",
};

describe("PendingInvitations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.query = { isLoading: false, isError: false, error: null, data: [INVITE] };
  });

  it("lists each pending invitation with its role", () => {
    render(<PendingInvitations canManage />);

    const list = screen.getByRole("list", { name: "Pending invitations" });
    expect(within(list).getByText("guest@example.test")).toBeInTheDocument();
    expect(within(list).getByText("View Only")).toBeInTheDocument();
    expect(mockQuery).toHaveBeenCalledWith(true);
  });

  it("resends the invitation it belongs to", async () => {
    const user = userEvent.setup();
    render(<PendingInvitations canManage />);

    await user.click(screen.getByRole("button", { name: "Resend invitation to guest@example.test" }));

    expect(mockResend.mutate).toHaveBeenCalledWith(INVITE);
  });

  it("revokes only after the confirm", async () => {
    const user = userEvent.setup();
    render(<PendingInvitations canManage />);

    await user.click(screen.getByRole("button", { name: "Revoke invitation to guest@example.test" }));
    expect(await screen.findByText(/will stop working straight away/)).toBeInTheDocument();
    expect(mockRevoke.mutate).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Revoke invitation" }));

    expect(mockRevoke.mutate).toHaveBeenCalledWith(INVITE);
  });

  it("keeps the invitation when the revoke is cancelled", async () => {
    const user = userEvent.setup();
    render(<PendingInvitations canManage />);

    await user.click(screen.getByRole("button", { name: "Revoke invitation to guest@example.test" }));
    await user.click(await screen.findByRole("button", { name: "Keep invitation" }));

    expect(mockRevoke.mutate).not.toHaveBeenCalled();
  });

  it("shows loading, empty and error states", () => {
    state.query = { isLoading: true, isError: false, error: null, data: [] };
    const { rerender } = render(<PendingInvitations canManage />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading invitations");

    state.query = { isLoading: false, isError: false, error: null, data: [] };
    rerender(<PendingInvitations canManage />);
    expect(screen.getByText("No invitations are waiting.")).toBeInTheDocument();

    state.query = { isLoading: false, isError: true, error: new Error("boom"), data: [] };
    rerender(<PendingInvitations canManage />);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load invitations.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("renders nothing and does not fetch for a member who cannot manage invitations", () => {
    const { container } = render(<PendingInvitations canManage={false} />);

    expect(container).toBeEmptyDOMElement();
    expect(mockQuery).toHaveBeenCalledWith(false);
  });
});
