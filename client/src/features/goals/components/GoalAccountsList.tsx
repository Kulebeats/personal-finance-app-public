import { Banknote } from "lucide-react";

import { ScrollArea } from "@/components/ui/scroll-area";

import {
  AccountGoalSetting,
  TYPE_ICONS,
  type AccountGroupName,
} from "./GoalAccountsModalData";
import { GoalAccountCard } from "./GoalAccountCard";
import type { Goal } from "../types";

type GoalAccountsListProps = {
  groupedAccounts: Record<string, any[]>;
  getAccountSetting: (accountId: string) => AccountGoalSetting;
  assignmentsByAccount: Map<string, any[]>;
  goals: Goal[];
  goalsById: Map<string, any>;
  formatCurrency: (value: number) => string;
  isSaving: boolean;
  hasAccounts: boolean;
  updateAccountSetting: (
    accountId: string,
    updates: Partial<AccountGoalSetting>
  ) => void;
  toast: (options: {
    title: string;
    description: string;
    variant?: "destructive" | "default";
  }) => void;
};

export function GoalAccountsList({
  groupedAccounts,
  getAccountSetting,
  assignmentsByAccount,
  goals,
  goalsById,
  formatCurrency,
  isSaving,
  hasAccounts,
  updateAccountSetting,
  toast,
}: GoalAccountsListProps) {
  return (
    <ScrollArea className="flex-1 -mx-6 px-6">
      <div className="space-y-6 py-4">
        {Object.entries(groupedAccounts).map(([group, groupAccounts]) => {
          const Icon = TYPE_ICONS[group as AccountGroupName] || Banknote;

          return (
            <div key={group} className="space-y-3">
              <div className="font-medium text-sm">{group}</div>
              <div className="space-y-4">
                {groupAccounts.map((account) => (
                  <GoalAccountCard
                    key={account.id}
                    account={account}
                    icon={Icon}
                    setting={getAccountSetting(account.id)}
                    accountAssignments={
                      assignmentsByAccount.get(account.id) ?? []
                    }
                    goals={goals}
                    goalsById={goalsById}
                    formatCurrency={formatCurrency}
                    isSaving={isSaving}
                    onUpdateSetting={(updates) =>
                      updateAccountSetting(account.id, updates)
                    }
                    toast={toast}
                  />
                ))}
              </div>
            </div>
          );
        })}

        {!hasAccounts && (
          <div className="text-center py-12 text-muted-foreground">
            No accounts found. Add an account to get started.
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
