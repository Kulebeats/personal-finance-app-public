import { forwardRef, type ComponentPropsWithoutRef } from "react";
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
import { Users, User } from "lucide-react";

interface OwnerSelectorProps extends Pick<ComponentPropsWithoutRef<typeof SelectTrigger>,
  "id" | "aria-describedby" | "aria-invalid" | "aria-label" | "aria-labelledby" | "onBlur"> {
  value: string | null; // null = Shared, string = userId
  onChange: (value: string | null) => void;
  disabled?: boolean;
  className?: string;
}

export const OwnerSelector = forwardRef<HTMLButtonElement, OwnerSelectorProps>(function OwnerSelector({
  value,
  onChange,
  disabled,
  className,
  ...triggerProps
}, ref) {
  const { data: members = [] } = useHouseholdMembers();
  const { data: profile } = useProfile();

  // Sort members: Me first, then others alphabetically
  const sortedMembers = [...members].sort((a, b) => {
    if (a.userId === profile?.id) return -1;
    if (b.userId === profile?.id) return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <Select
      value={value === null ? "shared" : value}
      onValueChange={(val) => onChange(val === "shared" ? null : val)}
      disabled={disabled}
    >
      <SelectTrigger ref={ref} className={cn("w-full", className)} {...triggerProps}>
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
                <AvatarFallback className="text-[10px]">
                  {member.name.substring(0, 2).toUpperCase() || "U"}
                </AvatarFallback>
              </Avatar>
              <span>
                {member.userId === profile?.id
                  ? "Me"
                  : member.name}
              </span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
});
