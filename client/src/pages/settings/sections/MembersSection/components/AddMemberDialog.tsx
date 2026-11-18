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
import { UserPlus, Loader2, Shield, Briefcase, Eye } from "lucide-react";
import { useAddMember } from "@/hooks/use-settings";

interface AddMemberDialogProps {
  children?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function AddMemberDialog({ children, open: controlledOpen, onOpenChange }: AddMemberDialogProps) {
  const addMember = useAddMember();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [newMemberRole, setNewMemberRole] = useState("member");

  // Use controlled state if provided, otherwise use internal state
  const isOpen = controlledOpen !== undefined ? controlledOpen : uncontrolledOpen;
  const setIsOpen = onOpenChange || setUncontrolledOpen;

  const handleAddMember = () => {
    if (!newMemberEmail.trim()) return;
    addMember.mutate(
      { emailOrUsername: newMemberEmail.trim(), role: newMemberRole },
      {
        onSuccess: () => {
          setIsOpen(false);
          setNewMemberEmail("");
          setNewMemberRole("member");
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
          <DialogTitle>Add Household Member</DialogTitle>
          <DialogDescription>
            Add an existing user to your household. They must have a registered
            account first.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label htmlFor="member-email">Email or Username</Label>
            <Input
              id="member-email"
              value={newMemberEmail}
              onChange={(e) => setNewMemberEmail(e.target.value)}
              placeholder="user@example.com or username"
            />
            <p className="text-xs text-muted-foreground">
              The user must already have a registered account.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="member-role">Role</Label>
            <Select value={newMemberRole} onValueChange={setNewMemberRole}>
              <SelectTrigger id="member-role" aria-label="Select role for new member">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4" />
                    <span>Admin - Can manage members and settings</span>
                  </div>
                </SelectItem>
                <SelectItem value="member">
                  <div className="flex items-center gap-2">
                    <Briefcase className="w-4 h-4" />
                    <span>Member - Can add/edit transactions</span>
                  </div>
                </SelectItem>
                <SelectItem value="view_only">
                  <div className="flex items-center gap-2">
                    <Eye className="w-4 h-4" />
                    <span>View Only - Read-only access</span>
                  </div>
                </SelectItem>
                <SelectItem value="professional">
                  <div className="flex items-center gap-2">
                    <Briefcase className="w-4 h-4" />
                    <span>Professional - Advisor access</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={handleAddMember}
            disabled={addMember.isPending || !newMemberEmail.trim()}
            className="w-full bg-rose-500 hover:bg-rose-600"
          >
            {addMember.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Adding...
              </>
            ) : (
              "Add Member"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
