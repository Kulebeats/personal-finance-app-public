import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { useState } from "react";
import { isCurrencyCode } from "@shared/denomination";
import { useCreateAccount } from "@/hooks/useAccounts";
import { useHousehold } from "@/hooks/use-settings";
import { parseMoneyString } from "@/lib/money";

import { AccountDetailsForm } from "./AccountDetailsForm";
import { AccountSuccessStep } from "./AccountSuccessStep";
import { AccountTypeSelection } from "./AccountTypeSelection";
import { AccountType, getPlaceholderName } from "./AccountModalData";

export function AddAccountModal({
  children,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  onCloseAutoFocus,
}: {
  children?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const [localOpen, setLocalOpen] = useState(false);
  const [draftNumber, setDraftNumber] = useState(0);
  const open = controlledOpen ?? localOpen;
  const changeOpen = (next: boolean) => {
    if (controlledOpen === undefined) setLocalOpen(next);
    controlledOnOpenChange?.(next);
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent onCloseAutoFocus={onCloseAutoFocus} className="max-w-2xl p-0 overflow-y-auto gap-0 bg-card border-border">
        {open && <AccountEditor key={draftNumber} onAddAnother={() => setDraftNumber(previous => previous + 1)} />}
      </DialogContent>
    </Dialog>
  );
}

function AccountEditor({ onAddAnother }: { onAddAnother: () => void }) {
  const [step, setStep] = useState<"type-select" | "details" | "success">(
    "type-select",
  );
  const [selectedType, setSelectedType] = useState<AccountType>(null);
  const [selectedBank, setSelectedBank] = useState<string>("");
  const [accountName, setAccountName] = useState("");
  const [balance, setBalance] = useState("");
  const [accountSubType, setAccountSubType] = useState("");
  const [selectedCurrency, setSelectedCurrency] = useState<string>();
  const [notes, setNotes] = useState("");
  const [institution, setInstitution] = useState("");
  const [ownerUserId, setOwnerUserId] = useState<string | null>(null);
  const [otherAccountType, setOtherAccountType] = useState("");
  // TODO-022: New state for previously unwired fields
  const [investmentType, setInvestmentType] = useState("");
  const [creditLimit, setCreditLimit] = useState("");
  const [apr, setApr] = useState("");
  const [statementDay, setStatementDay] = useState("");
  const [estimatedValue, setEstimatedValue] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [address, setAddress] = useState("");

  const createMutation = useCreateAccount();
  const household = useHousehold();
  const defaultCurrency = household.data?.household?.currency;
  const currency = selectedCurrency ?? (isCurrencyCode(defaultCurrency) ? defaultCurrency : "");

  const handleTypeSelect = (type: AccountType) => {
    setSelectedType(type);
    setStep("details");
  };

  const mapTypeToStorageType = (
    type: AccountType,
  ):
    | "checking"
    | "savings"
    | "credit"
    | "investment"
    | "cash"
    | "mobile_money"
    | "loan"
    | "mortgage"
    | "other_liability"
    | "real_estate"
    | "vehicle"
    | "other" => {
    switch (type) {
      case "bank":
        return accountSubType === "savings" ? "savings" : "checking";
      case "mobile-money":
        return "mobile_money";
      case "cash":
        return "cash";
      case "investment":
        return "investment";
      case "credit":
        return "credit";
      case "loan":
        return "loan";
      case "mortgage":
        return "mortgage";
      case "other-liability":
        return "other_liability";
      case "property":
        return "real_estate";
      case "vehicle":
        return "vehicle";
      default:
        return "other";
    }
  };

  const handleSave = () => {
    if (!currency) return;
    const name =
      accountName || selectedBank || getPlaceholderName(selectedType);
    const balanceDecimal = parseMoneyString(balance);
    const institutionValue = selectedBank || institution || undefined;

    // Build payload with all applicable fields
    const payload: Parameters<typeof createMutation.mutate>[0] = {
      name,
      type: mapTypeToStorageType(selectedType),
      initialBalance: balanceDecimal.toFixed(2),
      institution: institutionValue,
      // Allow user-selected currency for all account types (MED-001 fix)
      currency,
      notes: notes || undefined,
      ownerUserId,
    };

    // Add credit card fields if applicable (CRIT-001 fix)
    if (selectedType === "credit" || selectedType === "loan") {
      if (creditLimit) {
        payload.creditLimit = parseMoneyString(creditLimit).toFixed(2);
      }
      if (apr) {
        payload.apr = parseFloat(apr);
      }
      if (statementDay) {
        payload.statementDay = parseInt(statementDay, 10);
      }
    }

    if (selectedType === "property" || selectedType === "vehicle") {
      if (estimatedValue) {
        payload.estimatedValue = parseMoneyString(estimatedValue).toFixed(2);
      }
      if (purchaseDate) {
        payload.purchaseDate = purchaseDate;
      }
      if (selectedType === "property" && address) {
        payload.address = address;
      }
    }

    createMutation.mutate(payload, {
      onSuccess: () => {
        setStep("success");
      },
    });
  };

  return (
    <>
      <DialogDescription className="sr-only">Add account details to track your balances.</DialogDescription>
      <div className="px-6 py-4 border-b border-border flex items-center gap-4 bg-muted/30">
        {step === "details" && (
          <button
            onClick={() => setStep("type-select")}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Go back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}
        <DialogTitle className="text-lg font-semibold text-foreground">
          {step === "type-select" && "Add Account"}
          {step === "details" && "Enter Account Details"}
          {step === "success" && "Account Created"}
        </DialogTitle>
      </div>

      <div className="p-6">
        {step === "type-select" && (
          <AccountTypeSelection onSelectType={handleTypeSelect} />
        )}

        {step === "details" && selectedType && (
          <>
            {!currency && (household.isPending ? <p role="status">Loading household currency…</p> :
              <p role="alert">Household currency is unavailable. <button type="button" onClick={() => { void household.refetch(); }}>Retry</button></p>)}
            {createMutation.isError && (
              <div
                role="alert"
                className="mb-4 p-3 rounded-md bg-destructive/10 border border-destructive/20 flex items-start gap-2"
              >
                <AlertCircle
                  className="w-4 h-4 text-destructive mt-0.5 flex-shrink-0"
                  aria-hidden="true"
                />
                <div className="text-sm text-destructive">
                  <p className="font-medium">Failed to create account</p>
                  <p className="text-destructive/80">
                    {createMutation.error?.message ||
                      "An unexpected error occurred. Please try again."}
                  </p>
                </div>
              </div>
            )}
            <AccountDetailsForm
              selectedType={selectedType}
              selectedBank={selectedBank}
              onSelectedBankChange={setSelectedBank}
              accountName={accountName}
              onAccountNameChange={setAccountName}
              balance={balance}
              onBalanceChange={setBalance}
              accountSubType={accountSubType}
              onAccountSubTypeChange={setAccountSubType}
              currency={currency}
              onCurrencyChange={setSelectedCurrency}
              notes={notes}
              onNotesChange={setNotes}
              ownerUserId={ownerUserId}
              onOwnerChange={setOwnerUserId}
              otherAccountType={otherAccountType}
              onOtherAccountTypeChange={setOtherAccountType}
              // TODO-022: New props for previously unwired fields
              institution={institution}
              onInstitutionChange={setInstitution}
              investmentType={investmentType}
              onInvestmentTypeChange={setInvestmentType}
              creditLimit={creditLimit}
              onCreditLimitChange={setCreditLimit}
              apr={apr}
              onAprChange={setApr}
              statementDay={statementDay}
              onStatementDayChange={setStatementDay}
              estimatedValue={estimatedValue}
              onEstimatedValueChange={setEstimatedValue}
              purchaseDate={purchaseDate}
              onPurchaseDateChange={setPurchaseDate}
              address={address}
              onAddressChange={setAddress}
              onCancel={() => setStep("type-select")}
              onSave={handleSave}
              isSaving={createMutation.isPending}
            />
          </>
        )}

        {step === "success" && (
          <AccountSuccessStep onAddAnother={onAddAnother} />
        )}
      </div>
    </>
  );
}
