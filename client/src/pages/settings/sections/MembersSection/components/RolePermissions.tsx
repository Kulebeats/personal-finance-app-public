import { Crown, Shield, Eye, Briefcase } from "lucide-react";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "../roleDescriptions";

export function RolePermissions() {
  const roleIcons = {
    owner: Crown,
    admin: Shield,
    member: Briefcase,
    view_only: Eye,
    professional: Briefcase,
  };

  return (
    <div className="mt-6 p-4 rounded-lg bg-muted/50 border border-dashed">
      <h4 className="text-sm font-medium mb-2">Role Permissions</h4>
      <div className="space-y-2 text-xs text-muted-foreground">
        {Object.entries(ROLE_DESCRIPTIONS).map(([role, desc]) => {
          const Icon = roleIcons[role as keyof typeof roleIcons];
          return (
            <div key={role} className="flex items-start gap-2">
              {Icon && <Icon className="w-3 h-3 mt-0.5 shrink-0" />}
              <span>
                <strong className="text-foreground">
                  {ROLE_LABELS[role as keyof typeof ROLE_LABELS]}:
                </strong>{" "}
                {desc}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
