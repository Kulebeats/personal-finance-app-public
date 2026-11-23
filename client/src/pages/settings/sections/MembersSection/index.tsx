import { Suspense, useEffect, useState } from "react";
import { ErrorBoundary } from "@/features/settings/components/ErrorBoundary";
import { LoadingSection } from "@/features/settings/components/LoadingSection";
import { SettingsCard } from "@/features/settings/components/SettingsCard";
import { useHouseholdMembers, useProfile } from "@/hooks/use-settings";
import { SharedViewsCard } from "@/features/settings/saved-views/SharedViewsCard";
import { AddMemberDialog } from "./components/AddMemberDialog";
import { LeaveHouseholdButton } from "./components/LeaveHouseholdButton";
import { MemberList } from "./components/MemberList";
import { RolePermissions } from "./components/RolePermissions";

export default function MembersSection() {
  const { data: members = [], isLoading } = useHouseholdMembers();
  const { data: profile } = useProfile();
  const [addMemberDialogOpen, setAddMemberDialogOpen] = useState(false);

  const currentUserRole = members.find((m) => m.userId === profile?.id)?.role;
  const canManageRoles =
    currentUserRole === "owner" || currentUserRole === "admin";

  // Keyboard shortcut: 'N' to add new member (only for admins/owners)
  useEffect(() => {
    if (!canManageRoles) return;

    function handleKeyDown(e: KeyboardEvent) {
      // Only trigger if not typing in an input/textarea
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }

      // 'N' key to open Add Member dialog
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        setAddMemberDialogOpen(true);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [canManageRoles]);

  return (
    <ErrorBoundary sectionName="Members">
      <Suspense fallback={<LoadingSection variant="list" />}>
        <SettingsCard
          title="Household Members"
          description="Manage who has access to your household finances."
          isLoading={isLoading}
          action={
            canManageRoles && (
              <div className="flex items-center gap-2">
                <AddMemberDialog
                  canInviteAdmin={currentUserRole === "owner"}
                  open={addMemberDialogOpen}
                  onOpenChange={setAddMemberDialogOpen}
                />
                <span className="text-xs text-muted-foreground">
                  Press <kbd className="px-1.5 py-0.5 text-xs font-mono bg-muted rounded border">N</kbd> to add
                </span>
              </div>
            )
          }
        >
          <MemberList members={members} currentUserId={profile?.id} />

          <div className="mt-4 flex justify-end">
            <LeaveHouseholdButton currentUserRole={currentUserRole} />
          </div>

          <RolePermissions />

          <div className="mt-6">
            <SharedViewsCard canManage={canManageRoles} />
          </div>
        </SettingsCard>
      </Suspense>
    </ErrorBoundary>
  );
}
