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
import { Users } from "lucide-react";

interface OwnerFilterProps {
  value: string | null | "all"; // null = Shared, "all" = All, string = userId
  onChange: (value: string | null | "all") => void;
  className?: string;
}

export function OwnerFilter({ value, onChange, className }: OwnerFilterProps) {
  const { data: members = [] } = useHouseholdMembers();
  const { data: profile } = useProfile();

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
      onValueChange={(val) =>
        onChange(val === "shared" ? null : (val as "all" | string))
      }
    >
      <SelectTrigger className={cn("w-[200px]", className)}>
        <SelectValue placeholder="Filter by owner" />
      </SelectTrigger>
      <SelectContent>
        {/* 1. Mine */}
        {sortedMembers
          .filter((m) => m.userId === profile?.id)
          .map((member) => (
            <SelectItem
              key={member.userId}
              value={member.userId}
              className="cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Avatar className="h-5 w-5">
                  <AvatarImage
                    src={member.user?.profilePictureUrl || undefined}
                  />
                  <AvatarFallback className="text-[9px]">
                    {member.user?.username?.substring(0, 2).toUpperCase() ||
                      "U"}
                  </AvatarFallback>
                </Avatar>
                <span>My Transactions</span>
              </div>
            </SelectItem>
          ))}

        {/* 2. Joint */}
        <SelectItem value="shared" className="cursor-pointer">
          <div className="flex items-center gap-2">
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10">
              <Users className="h-3 w-3 text-primary" />
            </div>
            <span>Shared Only</span>
          </div>
        </SelectItem>

        {/* 3. Partner / Others - only show if there are linked accounts */}
        {sortedMembers.filter((m) => m.userId !== profile?.id).length > 0 &&
          sortedMembers
            .filter((m) => m.userId !== profile?.id)
            .map((member) => (
              <SelectItem
                key={member.userId}
                value={member.userId}
                className="cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Avatar className="h-5 w-5">
                    <AvatarImage
                      src={member.user?.profilePictureUrl || undefined}
                    />
                    <AvatarFallback className="text-[9px]">
                      {member.user?.username?.substring(0, 2).toUpperCase() ||
                        "U"}
                    </AvatarFallback>
                  </Avatar>
                  <span>{member.user?.fullName || member.user?.username}</span>
                </div>
              </SelectItem>
            ))}

        {/* 4. All */}
        <SelectItem value="all">All Transactions</SelectItem>
      </SelectContent>
    </Select>
  );
}
