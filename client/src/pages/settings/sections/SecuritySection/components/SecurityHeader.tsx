import React from "react";
import { Shield } from "lucide-react";

export function SecurityHeader() {
  return (
    <div className="flex items-center gap-3 mb-6">
      <Shield className="w-6 h-6 text-primary" />
      <div>
        <h2 className="text-xl font-semibold">Security</h2>
        <p className="text-sm text-muted-foreground">
          Manage your account security and privacy
        </p>
      </div>
    </div>
  );
}
