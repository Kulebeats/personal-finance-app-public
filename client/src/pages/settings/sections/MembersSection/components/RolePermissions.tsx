import { Crown, Shield, Eye, Briefcase } from "lucide-react";

export function RolePermissions() {
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

  const roleDescriptions = {
    owner: "Full control over household",
    admin: "Can manage members and settings",
    member: "Can add/edit transactions",
    view_only: "Read-only access",
    professional: "Professional advisor access",
  };

  return (
    <div className="mt-6 p-4 rounded-lg bg-muted/50 border border-dashed">
      <h4 className="text-sm font-medium mb-2">Role Permissions</h4>
      <div className="space-y-2 text-xs text-muted-foreground">
        {Object.entries(roleDescriptions).map(([role, desc]) => {
          const Icon = roleIcons[role as keyof typeof roleIcons];
          return (
            <div key={role} className="flex items-start gap-2">
              {Icon && <Icon className="w-3 h-3 mt-0.5 shrink-0" />}
              <span>
                <strong className="text-foreground">
                  {roleLabels[role as keyof typeof roleLabels]}:
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
