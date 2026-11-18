import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { EXCHANGES, SECURITY_TYPES } from "./AddHoldingModalData";
import type { SecurityType, SecurityExchange } from "../types";

type AddHoldingNewSecurityStepProps = {
  newSymbol: string;
  onNewSymbolChange: (value: string) => void;
  newName: string;
  onNewNameChange: (value: string) => void;
  // P1-3 FIX: Use proper enum types
  newType: SecurityType;
  onNewTypeChange: (value: SecurityType) => void;
  newExchange: SecurityExchange;
  onNewExchangeChange: (value: SecurityExchange) => void;
  newCurrency: string;
  onNewCurrencyChange: (value: string) => void;
  onBack: () => void;
  onCreate: () => void;
  isPending: boolean;
};

export function AddHoldingNewSecurityStep({
  newSymbol,
  onNewSymbolChange,
  newName,
  onNewNameChange,
  newType,
  onNewTypeChange,
  newExchange,
  onNewExchangeChange,
  newCurrency,
  onNewCurrencyChange,
  onBack,
  onCreate,
  isPending,
}: AddHoldingNewSecurityStepProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Symbol *</Label>
          <Input
            placeholder="e.g. ZCCM"
            value={newSymbol}
            onChange={(event) => onNewSymbolChange(event.target.value)}
            maxLength={10}
          />
        </div>
        <div className="space-y-2">
          <Label>Type *</Label>
          <Select value={newType} onValueChange={(value) => onNewTypeChange(value as SecurityType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SECURITY_TYPES.map((type) => (
                <SelectItem key={type.value} value={type.value}>
                  {type.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Name *</Label>
        <Input
          placeholder="e.g. ZCCM Investments Holdings"
          value={newName}
          onChange={(event) => onNewNameChange(event.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Exchange</Label>
          <Select value={newExchange} onValueChange={(value) => onNewExchangeChange(value as SecurityExchange)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXCHANGES.map((exchange) => (
                <SelectItem key={exchange.value} value={exchange.value}>
                  {exchange.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Currency</Label>
          <Select value={newCurrency} onValueChange={onNewCurrencyChange}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ZMW">ZMW - Zambian Kwacha</SelectItem>
              <SelectItem value="USD">USD - US Dollar</SelectItem>
              <SelectItem value="ZAR">ZAR - South African Rand</SelectItem>
              <SelectItem value="GBP">GBP - British Pound</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <DialogFooter className="gap-2 sm:gap-0">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onCreate} disabled={!newSymbol || !newName || isPending}>
          {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Create Security
        </Button>
      </DialogFooter>
    </div>
  );
}
