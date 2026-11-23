import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UserPlus, Loader2, Shield, Briefcase, Eye, GraduationCap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { InvitableRole } from "@shared/household-members";
import { useInviteMember } from "@/hooks/use-household-membership";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "../roleDescriptions";

interface AddMemberDialogProps {
  /** Only the owner may invite an admin (spec §A3). */
  canInviteAdmin: boolean;
  children?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface RoleOption {
  value: InvitableRole;
  label: string;
  icon: LucideIcon;
}

const DEFAULT_ROLE: InvitableRole = "member";
const ROLE_ICONS: ReadonlyArray<Omit<RoleOption, "label">> = [
  { value: "admin", icon: Shield },
  { value: "member", icon: Briefcase },
  { value: "view_only", icon: Eye },
  { value: "professional", icon: GraduationCap },
];
// AH-13: the same role lines as the members screen, so neither promises more than the server grants.
const ROLE_OPTIONS: readonly RoleOption[] = ROLE_ICONS.map(option => ({
  ...option, label: `${ROLE_LABELS[option.value]} - ${ROLE_DESCRIPTIONS[option.value]}`,
}));

/** AH-05: Add Member sends an email invitation (POST /api/household/invite). */
export function AddMemberDialog({ canInviteAdmin, children, open: controlledOpen, onOpenChange }: AddMemberDialogProps) {
  const inviteMember = useInviteMember();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitableRole>(DEFAULT_ROLE);

  // Use controlled state if provided, otherwise use internal state
  const isOpen = controlledOpen !== undefined ? controlledOpen : uncontrolledOpen;
  const setIsOpen = onOpenChange || setUncontrolledOpen;
  const roleOptions = ROLE_OPTIONS.filter((option) => canInviteAdmin || option.value !== "admin");
  const trimmedEmail = email.trim();

  const handleInvite = () => {
    if (!trimmedEmail) return;
    inviteMember.mutate(
      { email: trimmedEmail, role },
      {
        onSuccess: () => {
          setIsOpen(false);
          setEmail("");
          setRole(DEFAULT_ROLE);
        },
      },
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {children || (
          <Button size="sm" className="bg-rose-500 hover:bg-rose-600">
            <UserPlus className="w-4 h-4 mr-2" />
            Add Member
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a household member</DialogTitle>
          <DialogDescription>
            We'll email them an invitation. They join once they accept it while
            signed in with that address.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label htmlFor="member-email">Email address</Label>
            <Input
              id="member-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="partner@example.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="member-role">Role</Label>
            <Select value={role} onValueChange={(value) => setRole(value as InvitableRole)}>
              <SelectTrigger id="member-role" aria-label="Select role for new member">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roleOptions.map(({ value, label, icon: Icon }) => (
                  <SelectItem key={value} value={value}>
                    <div className="flex items-center gap-2">
                      <Icon className="w-4 h-4" aria-hidden="true" />
                      <span>{label}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={handleInvite}
            disabled={inviteMember.isPending || !trimmedEmail}
            className="w-full bg-rose-500 hover:bg-rose-600"
          >
            {inviteMember.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Sending...
              </>
            ) : (
              "Send invitation"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
