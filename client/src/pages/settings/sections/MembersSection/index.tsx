import { Suspense, useEffect, useState } from "react";
import { ErrorBoundary } from "@/features/settings/components/ErrorBoundary";
import { LoadingSection } from "@/features/settings/components/LoadingSection";
import { SettingsCard } from "@/features/settings/components/SettingsCard";
import { useHouseholdMembers, useProfile } from "@/hooks/use-settings";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield, Users } from "lucide-react";
import { AddMemberDialog } from "./components/AddMemberDialog";
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

          <RolePermissions />

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <Card className="border-border shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">
                  Shared Views
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-full bg-blue-100 text-blue-600">
                    <Shield className="w-5 h-5" />
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                      Control what your partner or advisor can see by hiding
                      specific accounts or categories.
                    </p>
                    <Button variant="link" className="px-0">
                      Configure shared views →
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">
                  Your Plan
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between border-b border-border/40 pb-3">
                  <div>
                    <div className="text-sm font-medium">Household Premium</div>
                    <div className="text-xs text-muted-foreground">
                      Includes 2 members
                    </div>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    Active
                  </Badge>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Users className="w-4 h-4" />
                  <span>Unlimited collaborators included</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </SettingsCard>
      </Suspense>
    </ErrorBoundary>
  );
}
