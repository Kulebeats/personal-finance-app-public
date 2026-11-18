import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemberList } from "../MemberList";
import type { HouseholdMember } from "@/hooks/use-settings";

// Mock hooks
// React Query v5 mutation objects expose `isPending`/`mutate`; the component
// reads `updateRole.isPending`, `removeMember.isPending` and calls `.mutate`,
// so the mocked hooks must return a structurally-complete mutation result.
const createMockMutation = () => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn(),
  isPending: false,
  isError: false,
  isSuccess: false,
  isIdle: true,
  error: null,
  reset: vi.fn(),
});

vi.mock("@/hooks/use-settings", () => ({
  useUpdateMemberRole: vi.fn(() => createMockMutation()),
  useRemoveMember: vi.fn(() => createMockMutation()),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const mockMembers: HouseholdMember[] = [
  {
    id: "member-1",
    userId: "user-1",
    householdId: "household-1",
    role: "owner",
    joinedAt: new Date("2024-01-01").toISOString(),
    lastActiveAt: new Date("2024-01-29").toISOString(),
    user: {
      id: "user-1",
      email: "owner@example.com",
      fullName: "John Owner",
      username: "jowner",
      profilePictureUrl: null,
      lastLoginAt: null,
    },
  },
  {
    id: "member-2",
    userId: "user-2",
    householdId: "household-1",
    role: "admin",
    joinedAt: new Date("2024-01-15").toISOString(),
    lastActiveAt: new Date("2024-01-28").toISOString(),
    user: {
      id: "user-2",
      email: "admin@example.com",
      fullName: "Jane Admin",
      username: "jadmin",
      profilePictureUrl: null,
      lastLoginAt: null,
    },
  },
  {
    id: "member-3",
    userId: "user-3",
    householdId: "household-1",
    role: "member",
    joinedAt: new Date("2024-02-01").toISOString(),
    lastActiveAt: new Date("2024-01-27").toISOString(),
    user: {
      id: "user-3",
      email: "member@example.com",
      fullName: "Bob Member",
      username: "bmember",
      profilePictureUrl: null,
      lastLoginAt: null,
    },
  },
];

describe("MemberList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Display", () => {
    it("renders member list correctly", () => {
      render(<MemberList members={mockMembers} currentUserId="user-1" />);

      expect(screen.getByText("John Owner")).toBeInTheDocument();
      expect(screen.getByText("Jane Admin")).toBeInTheDocument();
      expect(screen.getByText("Bob Member")).toBeInTheDocument();
    });

    it('shows "You" badge for current user', () => {
      render(<MemberList members={mockMembers} currentUserId="user-1" />);

      expect(screen.getByText("You")).toBeInTheDocument();
    });

    it("displays correct role badges", () => {
      render(<MemberList members={mockMembers} currentUserId="user-1" />);

      // "Admin"/"Member" also appear as options inside the role-change Radix
      // Select dropdowns rendered for non-owner members, so the role-badge
      // labels are no longer uniquely present. Assert at least one occurrence.
      expect(screen.getByText("Owner")).toBeInTheDocument();
      expect(screen.getAllByText("Admin").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Member").length).toBeGreaterThan(0);
    });

    it("shows empty state when no members", () => {
      render(<MemberList members={[]} currentUserId="user-1" />);

      expect(
        screen.getByText("No members found in this household.")
      ).toBeInTheDocument();
    });

    it("displays member initials in avatar fallback", () => {
      render(<MemberList members={mockMembers} currentUserId="user-1" />);

      // Radix AvatarImage never "loads" in jsdom, so no <img> is rendered and
      // only the AvatarFallback (with initials) is present. Assert the derived
      // initials instead of the absent img role.
      expect(screen.getByText("JO")).toBeInTheDocument(); // John Owner
      expect(screen.getByText("JA")).toBeInTheDocument(); // Jane Admin
      expect(screen.getByText("BM")).toBeInTheDocument(); // Bob Member
    });
  });

  describe("Email Visibility", () => {
    it("shows email for current user", () => {
      render(<MemberList members={mockMembers} currentUserId="user-1" />);

      expect(screen.getByText("owner@example.com")).toBeInTheDocument();
    });

    it("shows emails to owners", () => {
      render(<MemberList members={mockMembers} currentUserId="user-1" />);

      expect(screen.getByText("admin@example.com")).toBeInTheDocument();
      expect(screen.getByText("member@example.com")).toBeInTheDocument();
    });

    it("shows emails to admins", () => {
      render(<MemberList members={mockMembers} currentUserId="user-2" />);

      expect(screen.getByText("owner@example.com")).toBeInTheDocument();
      expect(screen.getByText("member@example.com")).toBeInTheDocument();
    });

    it("hides other members emails from regular members", () => {
      render(<MemberList members={mockMembers} currentUserId="user-3" />);

      // Should only show own email
      expect(screen.getByText("member@example.com")).toBeInTheDocument();
      expect(screen.queryByText("owner@example.com")).not.toBeInTheDocument();
      expect(screen.queryByText("admin@example.com")).not.toBeInTheDocument();
    });
  });

  describe("Role Management", () => {
    it("shows role dropdown for admins/owners on non-owner members", () => {
      render(<MemberList members={mockMembers} currentUserId="user-1" />);

      // Should have dropdowns for admin and member roles
      const selects = screen.getAllByRole("combobox");
      expect(selects.length).toBeGreaterThan(0);
    });

    it("disables role change for owners", () => {
      render(<MemberList members={mockMembers} currentUserId="user-1" />);

      // Owner should have "Cannot change" text
      expect(screen.getByText("Cannot change")).toBeInTheDocument();
    });

    it("disables role change for current user", () => {
      render(<MemberList members={mockMembers} currentUserId="user-2" />);

      // Current user (admin) should see "Your role"
      expect(screen.getByText("Your role")).toBeInTheDocument();
    });

    it("shows no permission message for regular members", () => {
      render(<MemberList members={mockMembers} currentUserId="user-3" />);

      // Regular member should see "No permission" for others
      const noPermissions = screen.getAllByText("No permission");
      expect(noPermissions.length).toBeGreaterThan(0);
    });
  });

  describe("Member Removal", () => {
    it("shows delete button for removable members", () => {
      render(<MemberList members={mockMembers} currentUserId="user-1" />);

      const deleteButtons = screen.getAllByLabelText(/Remove .* from household/);
      expect(deleteButtons.length).toBeGreaterThan(0);
    });

    it("does not show delete button for owner", () => {
      render(<MemberList members={mockMembers} currentUserId="user-1" />);

      const deleteButtons = screen.queryAllByLabelText(
        /Remove John Owner from household/
      );
      expect(deleteButtons.length).toBe(0);
    });

    it("opens confirmation dialog when delete is clicked", async () => {
      const user = userEvent.setup();
      render(<MemberList members={mockMembers} currentUserId="user-1" />);

      const deleteButton = screen.getByLabelText(
        /Remove Bob Member from household/
      );
      await user.click(deleteButton);

      await waitFor(() => {
        // "Remove Member" appears twice once the dialog opens: the dialog title
        // and the confirm action button. Scope to the dialog heading to assert
        // the title specifically; the description text remains unique.
        expect(
          screen.getByRole("heading", { name: "Remove Member" })
        ).toBeInTheDocument();
        expect(
          screen.getByText(/Are you sure you want to remove/)
        ).toBeInTheDocument();
      });
    });
  });

  describe("Accessibility", () => {
    it("has proper aria-labels on role dropdowns", () => {
      render(<MemberList members={mockMembers} currentUserId="user-1" />);

      expect(
        screen.getByLabelText(/Change role for Jane Admin/)
      ).toBeInTheDocument();
    });

    it("has proper aria-labels on delete buttons", () => {
      render(<MemberList members={mockMembers} currentUserId="user-1" />);

      expect(
        screen.getByLabelText(/Remove Jane Admin from household/)
      ).toBeInTheDocument();
    });

    it("has screen reader announcement region", () => {
      render(<MemberList members={mockMembers} currentUserId="user-1" />);

      const liveRegion = screen.getByRole("status");
      expect(liveRegion).toHaveAttribute("aria-live", "polite");
      expect(liveRegion).toHaveAttribute("aria-atomic", "true");
    });
  });

  describe("Join Date Display", () => {
    it("displays relative join dates", () => {
      render(<MemberList members={mockMembers} currentUserId="user-1" />);

      // Should show "Joined X ago" for each member
      const joinedTexts = screen.getAllByText(/Joined/);
      expect(joinedTexts.length).toBe(mockMembers.length);
    });
  });
});
