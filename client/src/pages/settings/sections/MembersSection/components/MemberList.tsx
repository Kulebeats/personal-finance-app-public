import { useState, useRef, useEffect } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ToastAction } from "@/components/ui/toast";
import { Trash2, Crown, Shield, Eye, Briefcase } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { useUpdateMemberRole, useRemoveMember } from "@/hooks/use-settings";
import type { HouseholdMember } from "@/hooks/use-settings";
import { useToast } from "@/hooks/use-toast";

interface MemberListProps {
  members: HouseholdMember[];
  currentUserId: string | undefined;
}

const roleIcons = {
  owner: Crown,
  admin: Shield,
  member: Briefcase,
  view_only: Eye,
  professional: Briefcase,
};

const roleLabels = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  view_only: "View Only",
  professional: "Professional",
};

const roleColors = {
  owner: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700",
  admin: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-700",
  member: "bg-green-500/10 text-green-700 dark:text-green-400 border-green-300 dark:border-green-700",
  view_only: "bg-muted/50 text-muted-foreground border-border",
  professional: "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-300 dark:border-purple-700",
};

export function MemberList({ members, currentUserId }: MemberListProps) {
  const updateRole = useUpdateMemberRole();
  const removeMember = useRemoveMember();
  const { toast } = useToast();
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [memberToRemove, setMemberToRemove] = useState<{
    userId: string;
    name: string;
  } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const pendingRemovalTimerRef = useRef<NodeJS.Timeout | null>(null);

  const currentUserRole = members.find((m) => m.userId === currentUserId)?.role;
  const canManageRoles =
    currentUserRole === "owner" || currentUserRole === "admin";

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (pendingRemovalTimerRef.current) {
        clearTimeout(pendingRemovalTimerRef.current);
      }
    };
  }, []);

  const handleRoleChange = (userId: string, newRole: string) => {
    updateRole.mutate({ userId, role: newRole });
  };

  const handleRemoveMember = (
    userId: string,
    name: string,
  ) => {
    setMemberToRemove({ userId, name });
    setAnnouncement(`Remove member confirmation dialog opened for ${name}`);
  };

  const executeRemoval = (userId: string) => {
    setRemovingMemberId(userId);
    removeMember.mutate(userId, {
      onSettled: () => {
        setRemovingMemberId(null);
        pendingRemovalTimerRef.current = null;
      },
    });
  };

  const cancelPendingRemoval = () => {
    if (pendingRemovalTimerRef.current) {
      clearTimeout(pendingRemovalTimerRef.current);
      pendingRemovalTimerRef.current = null;
      toast({
        title: "Removal cancelled",
        description: "Member removal has been cancelled",
      });
    }
  };

  const confirmRemoveMember = () => {
    if (!memberToRemove) return;

    // Close the dialog
    setMemberToRemove(null);

    // Show toast with undo action and start 5-second timer
    const timerId = setTimeout(() => {
      executeRemoval(memberToRemove.userId);
    }, 5000);

    pendingRemovalTimerRef.current = timerId;

    toast({
      title: "Member will be removed",
      description: `${memberToRemove.name} will be removed in 5 seconds`,
      action: (
        <ToastAction
          altText="Undo member removal"
          onClick={cancelPendingRemoval}
        >
          Undo
        </ToastAction>
      ),
    });
  };

  const getInitials = (name: string | null, email: string) => {
    if (name) {
      return name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
    }
    return email.slice(0, 2).toUpperCase();
  };

  if (members.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No members found in this household.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {/* Screen reader announcements */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {announcement}
      </div>

      {members.map((member) => {
        const Icon = roleIcons[member.role as keyof typeof roleIcons];
        const isCurrentUser = member.userId === currentUserId;
        const isOwner = member.role === "owner";
        const canEditRole = canManageRoles && !isCurrentUser && !isOwner;
        const canRemove = canManageRoles && !isCurrentUser && !isOwner;

        return (
          <div
            key={member.id}
            className="flex items-center gap-4 p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
          >
            <Avatar className="h-12 w-12">
              <AvatarImage
                src={member.user?.profilePictureUrl || undefined}
                alt={member.user?.fullName || member.user?.username}
              />
              <AvatarFallback className="bg-primary/10 text-primary font-semibold">
                {getInitials(
                  member.user?.fullName || null,
                  member.user?.email || "",
                )}
              </AvatarFallback>
            </Avatar>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-medium truncate">
                  {member.user?.fullName ||
                    member.user?.username ||
                    "Unknown User"}
                </p>
                {isCurrentUser && (
                  <Badge variant="outline" className="text-xs">
                    You
                  </Badge>
                )}
              </div>
              {(canManageRoles || isCurrentUser) && (
                <p className="text-sm text-muted-foreground truncate">
                  {member.user?.email}
                </p>
              )}
              <div className="flex items-center gap-2 mt-1">
                <Badge
                  variant="outline"
                  className={cn(
                    "text-xs",
                    roleColors[member.role as keyof typeof roleColors],
                  )}
                >
                  {Icon && <Icon className="w-3 h-3 mr-1" />}
                  {roleLabels[member.role as keyof typeof roleLabels]}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  Joined{" "}
                  {formatDistanceToNow(new Date(member.joinedAt), {
                    addSuffix: true,
                  })}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {canEditRole ? (
                <Select
                  value={member.role}
                  onValueChange={(role) =>
                    handleRoleChange(member.userId, role)
                  }
                  disabled={updateRole.isPending}
                >
                  <SelectTrigger className="w-[140px]" aria-label={`Change role for ${member.user?.fullName || member.user?.username || 'member'}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">
                      <div className="flex items-center gap-2">
                        <Shield className="w-4 h-4" />
                        <span>Admin</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="member">
                      <div className="flex items-center gap-2">
                        <Briefcase className="w-4 h-4" />
                        <span>Member</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="view_only">
                      <div className="flex items-center gap-2">
                        <Eye className="w-4 h-4" />
                        <span>View Only</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="professional">
                      <div className="flex items-center gap-2">
                        <Briefcase className="w-4 h-4" />
                        <span>Professional</span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <div className="w-[140px] text-sm text-muted-foreground text-center">
                  {isOwner
                    ? "Cannot change"
                    : isCurrentUser
                      ? "Your role"
                      : "No permission"}
                </div>
              )}

              {canRemove && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    handleRemoveMember(
                      member.userId,
                      member.user?.fullName ||
                        member.user?.username ||
                        "this member",
                    )
                  }
                  disabled={
                    removeMember.isPending && removingMemberId === member.userId
                  }
                  className="text-destructive hover:text-destructive"
                  aria-label={`Remove ${member.user?.fullName || member.user?.username || 'member'} from household`}
                >
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                </Button>
              )}
            </div>
          </div>
        );
      })}

      <AlertDialog
        open={!!memberToRemove}
        onOpenChange={(open) => {
          if (!open) {
            setMemberToRemove(null);
            setAnnouncement("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Member</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove{" "}
              <span className="font-semibold">{memberToRemove?.name}</span> from
              the household? They will lose access immediately and won't be able
              to view any household data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRemoveMember}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove Member
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
