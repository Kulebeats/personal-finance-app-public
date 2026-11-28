import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { HouseholdMember } from "@/hooks/use-settings";
import MembersSection from "../index";

/**
 * AH-13: the members screen makes no collaboration promise the product does
 * not keep. There is no paid plan, no member allowance and no "advisor"
 * access level: View Only and Professional hold the same read-only grants
 * (server/core/authz/capabilities.ts). The children with their own data
 * hooks are stubbed; the Premium card lived in this section's own markup.
 */
const { members } = vi.hoisted(() => ({ members: { current: [] as HouseholdMember[] } }));
vi.mock("@/hooks/use-settings", () => ({
  useHouseholdMembers: () => ({ data: members.current, isLoading: false }),
  useProfile: () => ({ data: { id: "user-1" } }),
}));
vi.mock("../components/MemberList", () => ({ MemberList: () => <div data-testid="member-list" /> }));
vi.mock("../components/LeaveHouseholdButton", () => ({ LeaveHouseholdButton: () => null }));
vi.mock("../components/PendingInvitations", () => ({ PendingInvitations: () => null }));
vi.mock("../components/AddMemberDialog", () => ({ AddMemberDialog: () => <button type="button">Add Member</button> }));
vi.mock("@/features/settings/saved-views/SharedViewsCard", () => ({
  SharedViewsCard: ({ canManage }: { canManage: boolean }) => <section aria-label="Shared views" data-can-manage={String(canManage)} />,
}));

const member = (userId: string, role: HouseholdMember["role"]): HouseholdMember =>
  ({ userId, name: userId, role, joinedAt: "2026-11-01T00:00:00.000Z" });

const UNSUPPORTED_PROMISES = [
  /premium/i, /your plan/i, /unlimited/i, /collaborators included/i, /includes \d+ members?/i,
  /configure shared views/i, /advisor access/i, /upgrade/i,
];

describe("Members section collaboration copy (AH-13)", () => {
  beforeEach(() => {
    members.current = [member("user-1", "owner"), member("user-2", "member")];
  });

  it.each(["owner", "member", "view_only", "professional"] as const)("shows no plan, allowance or advisor promise to a %s", role => {
    members.current = [member("user-1", role), member("user-2", "owner")];
    const { container } = render(<MembersSection />);
    const text = container.textContent ?? "";
    for (const promise of UNSUPPORTED_PROMISES) expect(text, String(promise)).not.toMatch(promise);
    expect(screen.queryByRole("link", { name: /shared views/i })).not.toBeInTheDocument();
  });

  it("offers the working shared views card in place of the dead control, managed only by owners and admins", () => {
    const { unmount } = render(<MembersSection />);
    expect(screen.getByRole("region", { name: "Shared views" })).toHaveAttribute("data-can-manage", "true");
    unmount();
    members.current = [member("user-1", "view_only"), member("user-2", "owner")];
    render(<MembersSection />);
    expect(screen.getByRole("region", { name: "Shared views" })).toHaveAttribute("data-can-manage", "false");
  });

  it("describes View Only and Professional as the same read-only, no-export access", () => {
    render(<MembersSection />);
    const line = (label: string) => screen.getByText(`${label}:`).closest("span")?.textContent ?? "";
    expect(line("View Only")).toBe("View Only: Read-only access; cannot export household data");
    expect(line("Professional")).toBe("Professional: Read-only access for an outside adviser; cannot export household data");
  });
});
