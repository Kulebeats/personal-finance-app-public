/**
 * Merchant Aliases Section
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Alias {
  id: string;
  aliasName: string;
}

interface MerchantAliasSectionProps {
  aliases: Alias[];
  onAddAlias: (aliasName: string) => void;
  onDeleteAlias: (aliasId: string) => void;
  isAddPending: boolean;
  isDeletePending: boolean;
}

export function MerchantAliasSection({
  aliases,
  onAddAlias,
  onDeleteAlias,
  isAddPending,
  isDeletePending,
}: MerchantAliasSectionProps) {
  const [aliasInput, setAliasInput] = useState("");

  const handleAddAlias = () => {
    if (!aliasInput.trim()) return;
    onAddAlias(aliasInput.trim());
    setAliasInput("");
  };

  return (
    <div className="mt-6 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Aliases</h3>
      </div>
      <div className="flex gap-2">
        <Input
          value={aliasInput}
          placeholder="Add alias"
          onChange={(event) => setAliasInput(event.target.value)}
        />
        <Button
          type="button"
          variant="outline"
          onClick={handleAddAlias}
          disabled={isAddPending || !aliasInput.trim()}
        >
          Add
        </Button>
      </div>
      <div className="space-y-2">
        {aliases.length > 0 ? (
          aliases.map((alias) => (
            <div
              key={alias.id}
              className="flex items-center justify-between rounded border px-2 py-1 text-sm"
            >
              <span>{alias.aliasName}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onDeleteAlias(alias.id)}
                disabled={isDeletePending}
              >
                Remove
              </Button>
            </div>
          ))
        ) : (
          <p className="text-xs text-muted-foreground">No aliases yet.</p>
        )}
      </div>
    </div>
  );
}
