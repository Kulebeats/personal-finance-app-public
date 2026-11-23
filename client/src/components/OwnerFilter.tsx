import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useHouseholdMembers, useProfile } from "@/hooks/use-settings";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { Users } from "lucide-react";

interface OwnerFilterProps {
  value: string | null | "all"; // null = Shared, "all" = All, string = userId
  onChange: (value: string | null | "all") => void;
  className?: string;
  currentUserId?: string;
  allLabel?: string;
  mineLabel?: string;
  ariaLabel?: string;
}

export function OwnerFilter({ value, onChange, className, currentUserId, allLabel = "All Transactions", mineLabel = "My Transactions", ariaLabel = "Filter by owner" }: OwnerFilterProps) {
  const { data: members = [] } = useHouseholdMembers();
  const { data: profile } = useProfile();
  const ownId = currentUserId ?? profile?.id;

  const sortedMembers = [...members].sort((a, b) => {
    if (a.userId === ownId) return -1;
    if (b.userId === ownId) return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <Select
      value={value === null ? "shared" : value}
      onValueChange={(val) =>
        onChange(val === "shared" ? null : (val as "all" | string))
      }
    >
      <SelectTrigger className={cn("w-[200px]", className)} aria-label={ariaLabel}>
        <SelectValue placeholder="Filter by owner" />
      </SelectTrigger>
      <SelectContent>
        {/* 1. Mine */}
        {ownId && !sortedMembers.some(member => member.userId === ownId) && <SelectItem value={ownId}>{mineLabel}</SelectItem>}
        {sortedMembers
          .filter((m) => m.userId === ownId)
          .map((member) => (
            <SelectItem
              key={member.userId}
              value={member.userId}
              className="cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Avatar className="h-5 w-5">
                  <AvatarFallback className="text-[9px]">
                    {member.name.substring(0, 2).toUpperCase() || "U"}
                  </AvatarFallback>
                </Avatar>
                <span>{mineLabel}</span>
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
        {sortedMembers.filter((m) => m.userId !== ownId).length > 0 &&
          sortedMembers
            .filter((m) => m.userId !== ownId)
            .map((member) => (
              <SelectItem
                key={member.userId}
                value={member.userId}
                className="cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Avatar className="h-5 w-5">
                    <AvatarFallback className="text-[9px]">
                      {member.name.substring(0, 2).toUpperCase() || "U"}
                    </AvatarFallback>
                  </Avatar>
                  <span>{member.name}</span>
                </div>
              </SelectItem>
            ))}

        {/* 4. All */}
        <SelectItem value="all">{allLabel}</SelectItem>
      </SelectContent>
    </Select>
  );
}
