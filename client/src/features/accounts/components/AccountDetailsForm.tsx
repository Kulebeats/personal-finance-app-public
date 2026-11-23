import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BankLogo } from "@/components/BankLogo";
import { OwnerSelector } from "@/components/OwnerSelector";
import { getCurrencySymbol } from "@/lib/format";

import {
  AccountType,
  getPlaceholderName,
  MOBILE_MONEY_PROVIDERS,
  SUPPORTED_CURRENCIES,
  ZAMBIAN_BANKS,
} from "./AccountModalData";
import { CreditCardFields } from "./form/CreditCardFields";
import { PropertyFields } from "./form/PropertyFields";

/**
 * TODO-016/022: Props for all account form fields
 * All fields are now wired with proper state management
 */
type AccountDetailsFormProps = {
  selectedType: AccountType;
  selectedBank: string;
  onSelectedBankChange: (value: string) => void;
  accountName: string;
  onAccountNameChange: (value: string) => void;
  balance: string;
  onBalanceChange: (value: string) => void;
  accountSubType: string;
  onAccountSubTypeChange: (value: string) => void;
  currency: string;
  onCurrencyChange: (value: string) => void;
  notes: string;
  onNotesChange: (value: string) => void;
  ownerUserId: string | null;
  onOwnerChange: (value: string | null) => void;
  otherAccountType: string;
  onOtherAccountTypeChange: (value: string) => void;
  // TODO-022: Previously unwired fields
  institution: string;
  onInstitutionChange: (value: string) => void;
  investmentType: string;
  onInvestmentTypeChange: (value: string) => void;
  creditLimit: string;
  onCreditLimitChange: (value: string) => void;
  apr: string;
  onAprChange: (value: string) => void;
  statementDay: string;
  onStatementDayChange: (value: string) => void;
  estimatedValue: string;
  onEstimatedValueChange: (value: string) => void;
  purchaseDate: string;
  onPurchaseDateChange: (value: string) => void;
  address: string;
  onAddressChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
  isSaving?: boolean;
};

export function AccountDetailsForm({
  selectedType,
  selectedBank,
  onSelectedBankChange,
  accountName,
  onAccountNameChange,
  balance,
  onBalanceChange,
  accountSubType,
  onAccountSubTypeChange,
  currency,
  onCurrencyChange,
  notes,
  onNotesChange,
  ownerUserId,
  onOwnerChange,
  otherAccountType,
  onOtherAccountTypeChange,
  // TODO-022: New props
  institution,
  onInstitutionChange,
  investmentType,
  onInvestmentTypeChange,
  creditLimit,
  onCreditLimitChange,
  apr,
  onAprChange,
  statementDay,
  onStatementDayChange,
  estimatedValue,
  onEstimatedValueChange,
  purchaseDate,
  onPurchaseDateChange,
  address,
  onAddressChange,
  onCancel,
  onSave,
  isSaving = false,
}: AccountDetailsFormProps) {
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
      <div className="grid gap-4 py-4">
        {selectedType === "bank" && (
          <div className="space-y-2">
            <Label>Select Bank</Label>
            <Select onValueChange={onSelectedBankChange} value={selectedBank}>
              <SelectTrigger className="bg-background">
                <SelectValue placeholder="Select your bank" />
              </SelectTrigger>
              <SelectContent className="max-h-[200px]">
                {ZAMBIAN_BANKS.map((bank) => (
                  <SelectItem key={bank} value={bank}>
                    <div className="flex items-center gap-2">
                      <BankLogo institution={bank} size="sm" />
                      <span>{bank}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {selectedType === "mobile-money" && (
          <div className="space-y-2">
            <Label>Provider</Label>
            <Select onValueChange={onSelectedBankChange} value={selectedBank}>
              <SelectTrigger className="bg-background">
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent>
                {MOBILE_MONEY_PROVIDERS.map((provider) => (
                  <SelectItem key={provider} value={provider}>
                    <div className="flex items-center gap-2">
                      <BankLogo institution={provider} size="sm" />
                      <span>{provider}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {selectedType === "investment" && (
          <div className="space-y-2">
            <Label>Investment Type</Label>
            <Select
              value={investmentType}
              onValueChange={onInvestmentTypeChange}
            >
              <SelectTrigger className="bg-background">
                <SelectValue placeholder="Select investment type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="boz">BOZ Bonds</SelectItem>
                <SelectItem value="stocks">Stocks</SelectItem>
                <SelectItem value="retirement">Retirement Fund</SelectItem>
                <SelectItem value="crypto">Crypto</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="name">Account Name</Label>
            <Input
              id="name"
              placeholder={
                selectedBank && selectedBank !== "Other"
                  ? selectedBank
                  : getPlaceholderName(selectedType)
              }
              value={accountName}
              onChange={(event) => onAccountNameChange(event.target.value)}
              className="bg-background"
            />
          </div>
          {selectedType === "bank" && selectedBank === "Other" && (
            <div className="space-y-2">
              <Label htmlFor="institution">Bank Name</Label>
              <Input
                id="institution"
                placeholder="Enter bank name"
                value={institution}
                onChange={(event) => onInstitutionChange(event.target.value)}
                className="bg-background"
              />
            </div>
          )}
          {selectedType !== "bank" && selectedType !== "mobile-money" && (
            <div className="space-y-2">
              <Label htmlFor="institution">Institution / Platform</Label>
              <Input
                id="institution"
                placeholder=""
                value={institution}
                onChange={(event) => onInstitutionChange(event.target.value)}
                className="bg-background"
              />
            </div>
          )}

          {selectedType === "other" && (
            <div className="space-y-2 col-span-2">
              <Label htmlFor="other-type">Please specify account type</Label>
              <Input
                id="other-type"
                placeholder="e.g. Crypto wallet, Gift cards"
                value={otherAccountType}
                onChange={(event) =>
                  onOtherAccountTypeChange(event.target.value)
                }
                className="bg-background"
              />
            </div>
          )}
        </div>

        {(selectedType === "bank" ||
          selectedType === "mobile-money" ||
          selectedType === "cash" ||
          selectedType === "loan" ||
          selectedType === "mortgage" ||
          selectedType === "other-liability" ||
          selectedType === "other") && (
          <div className="space-y-2">
            <Label htmlFor="balance">Initial Balance</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                {getCurrencySymbol(currency)}
              </span>
              <Input
                id="balance"
                type="number"
                placeholder="0.00"
                value={balance}
                onChange={(event) => onBalanceChange(event.target.value)}
                className="bg-background pl-8"
              />
            </div>
          </div>
        )}

        {selectedType === "bank" && (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="type">Account Type</Label>
              <Select
                value={accountSubType}
                onValueChange={onAccountSubTypeChange}
              >
                <SelectTrigger className="bg-background">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="checking">Checking</SelectItem>
                  <SelectItem value="savings">Savings</SelectItem>
                  <SelectItem value="cd">CD</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="currency">Currency</Label>
              <Select value={currency} onValueChange={onCurrencyChange}>
                <SelectTrigger className="bg-background">
                  <SelectValue placeholder="Select currency" />
                </SelectTrigger>
                <SelectContent>
                  {SUPPORTED_CURRENCIES.map((item) => (
                    <SelectItem key={item.code} value={item.code}>
                      {item.symbol} - {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {selectedType === "investment" && (
          <div className="space-y-2">
            <Label htmlFor="balance">Current Value</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                {getCurrencySymbol(currency)}
              </span>
              <Input
                id="balance"
                type="number"
                placeholder="0.00"
                value={balance}
                onChange={(event) => onBalanceChange(event.target.value)}
                className="bg-background pl-8"
              />
            </div>
          </div>
        )}

        {selectedType === "credit" && (
          <CreditCardFields
            balance={balance}
            onBalanceChange={onBalanceChange}
            creditLimit={creditLimit}
            onCreditLimitChange={onCreditLimitChange}
            apr={apr}
            onAprChange={onAprChange}
            statementDay={statementDay}
            onStatementDayChange={onStatementDayChange}
          />
        )}

        {(selectedType === "property" || selectedType === "vehicle") && (
          <PropertyFields
            estimatedValue={estimatedValue}
            onEstimatedValueChange={onEstimatedValueChange}
            purchaseDate={purchaseDate}
            onPurchaseDateChange={onPurchaseDateChange}
            address={address}
            onAddressChange={onAddressChange}
            showAddress={selectedType === "property"}
          />
        )}

        <div className="space-y-2">
          <Label>Owner</Label>
          <OwnerSelector value={ownerUserId} onChange={onOwnerChange} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="notes">Notes</Label>
          <Input
            id="notes"
            placeholder=""
            value={notes}
            onChange={(event) => onNotesChange(event.target.value)}
            className="bg-background"
          />
        </div>
      </div>

      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={onCancel} disabled={isSaving}>
          Cancel
        </Button>
        <Button onClick={onSave} disabled={isSaving || !currency}>
          {isSaving ? "Saving..." : "Save Account"}
        </Button>
      </div>
    </div>
  );
}
