import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useHouseholdMembers, useProfile } from "@/hooks/use-settings";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { Users, User } from "lucide-react";

interface OwnerSelectorProps {
  value: string | null; // null = Shared, string = userId
  onChange: (value: string | null) => void;
  disabled?: boolean;
  className?: string;
}

export function OwnerSelector({
  value,
  onChange,
  disabled,
  className,
}: OwnerSelectorProps) {
  const { data: members = [] } = useHouseholdMembers();
  const { data: profile } = useProfile();

  // Sort members: Me first, then others alphabetically
  const sortedMembers = [...members].sort((a, b) => {
    if (a.userId === profile?.id) return -1;
    if (b.userId === profile?.id) return 1;
    return (a.user?.fullName || a.user?.username || "").localeCompare(
      b.user?.fullName || b.user?.username || ""
    );
  });

  return (
    <Select
      value={value === null ? "shared" : value}
      onValueChange={(val) => onChange(val === "shared" ? null : val)}
      disabled={disabled}
    >
      <SelectTrigger className={cn("w-full", className)}>
        <SelectValue placeholder="Select owner" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="shared" className="cursor-pointer">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10">
              <Users className="h-3.5 w-3.5 text-primary" />
            </div>
            <span>Shared (Household)</span>
          </div>
        </SelectItem>
        {sortedMembers.map((member) => (
          <SelectItem
            key={member.userId}
            value={member.userId}
            className="cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <Avatar className="h-6 w-6">
                <AvatarImage
                  src={member.user?.profilePictureUrl || undefined}
                />
                <AvatarFallback className="text-[10px]">
                  {member.user?.username?.substring(0, 2).toUpperCase() || "U"}
                </AvatarFallback>
              </Avatar>
              <span>
                {member.userId === profile?.id
                  ? "Me"
                  : member.user?.fullName || member.user?.username || "Unknown"}
              </span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
