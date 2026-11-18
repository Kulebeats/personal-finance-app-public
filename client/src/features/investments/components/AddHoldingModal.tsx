import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  useSecurities,
  useCreateHolding,
  useCreateSecurity,
} from "@/hooks/useInvestments";
import { useAccounts } from "@/hooks/useAccounts";
import { useFormat } from "@/hooks/use-format";
import type { SecurityType, SecurityExchange } from "../types";

import { AddHoldingDetailsStep } from "./AddHoldingDetailsStep";
import { AddHoldingNewSecurityStep } from "./AddHoldingNewSecurityStep";
import { AddHoldingSecurityStep } from "./AddHoldingSecurityStep";

interface AddHoldingModalProps {
  children: React.ReactNode;
  onSuccess?: () => void;
}

type Step = "select-security" | "enter-details";

export function AddHoldingModal({ children, onSuccess }: AddHoldingModalProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("select-security");

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSecurityId, setSelectedSecurityId] = useState<string | null>(
    null
  );
  const [isCreatingNew, setIsCreatingNew] = useState(false);

  const [newSymbol, setNewSymbol] = useState("");
  const [newName, setNewName] = useState("");
  // P1-3 FIX: Use proper types instead of string
  const [newType, setNewType] = useState<SecurityType>("stock");
  const [newExchange, setNewExchange] = useState<SecurityExchange>("luse");
  const [newCurrency, setNewCurrency] = useState("ZMW");

  const [accountId, setAccountId] = useState<string>("");
  const [quantity, setQuantity] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(
    new Date().toISOString().split("T")[0]
  );

  const { formatCurrency } = useFormat();
  const { data: securities = [], isLoading: loadingSecurities } = useSecurities(
    { search: searchQuery }
  );
  const { data: accounts = [] } = useAccounts();
  const createHolding = useCreateHolding();
  const createSecurity = useCreateSecurity();

  const investmentAccounts =
    accounts.filter((account) => account.type === "investment") || accounts;

  useEffect(() => {
    if (open) {
      setStep("select-security");
      setSearchQuery("");
      setSelectedSecurityId(null);
      setIsCreatingNew(false);
      setNewSymbol("");
      setNewName("");
      setNewType("stock");
      setNewExchange("luse");
      setNewCurrency("ZMW");
      setAccountId(investmentAccounts[0]?.id || "");
      setQuantity("");
      setPurchasePrice("");
      setPurchaseDate(new Date().toISOString().split("T")[0]);
    }
  }, [open]);

  const handleSecuritySelect = (securityId: string) => {
    setSelectedSecurityId(securityId);
    setStep("enter-details");
  };

  const handleCreateNewSecurity = async () => {
    if (!newSymbol || !newName) return;

    try {
      // P1-3 FIX: removed the unsafe cast - state is now properly typed
      const result = await createSecurity.mutateAsync({
        symbol: newSymbol.toUpperCase(),
        name: newName,
        type: newType,
        exchange: newExchange,
        currency: newCurrency,
      });

      setSelectedSecurityId(result.data.id);
      setIsCreatingNew(false);
      setStep("enter-details");
    } catch (error) {
      // Error handled by hook
    }
  };

  const handleSubmit = async () => {
    if (!selectedSecurityId || !accountId || !quantity || !purchasePrice)
      return;

    const totalCost = Number(quantity) * Number(purchasePrice);

    try {
      await createHolding.mutateAsync({
        securityId: selectedSecurityId,
        accountId,
        quantity,
        costBasis: String(totalCost),
        acquiredDate: purchaseDate,
      });

      setOpen(false);
      onSuccess?.();
    } catch (error) {
      // Error handled by hook
    }
  };

  const totalValue =
    Number(quantity || "0") * Number(purchasePrice || "0");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">
            {step === "select-security"
              ? "Add Investment Holding"
              : "Enter Purchase Details"}
          </DialogTitle>
        </DialogHeader>

        {step === "select-security" && !isCreatingNew && (
          <AddHoldingSecurityStep
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            securities={securities}
            loadingSecurities={loadingSecurities}
            formatCurrency={formatCurrency}
            onSelectSecurity={handleSecuritySelect}
            onCreateNew={() => setIsCreatingNew(true)}
          />
        )}

        {step === "select-security" && isCreatingNew && (
          <AddHoldingNewSecurityStep
            newSymbol={newSymbol}
            onNewSymbolChange={(value) => setNewSymbol(value.toUpperCase())}
            newName={newName}
            onNewNameChange={setNewName}
            newType={newType}
            onNewTypeChange={setNewType}
            newExchange={newExchange}
            onNewExchangeChange={setNewExchange}
            newCurrency={newCurrency}
            onNewCurrencyChange={setNewCurrency}
            onBack={() => setIsCreatingNew(false)}
            onCreate={handleCreateNewSecurity}
            isPending={createSecurity.isPending}
          />
        )}

        {step === "enter-details" && (
          <AddHoldingDetailsStep
            accountId={accountId}
            onAccountChange={setAccountId}
            investmentAccounts={investmentAccounts}
            quantity={quantity}
            onQuantityChange={setQuantity}
            purchasePrice={purchasePrice}
            onPurchasePriceChange={setPurchasePrice}
            purchaseDate={purchaseDate}
            onPurchaseDateChange={setPurchaseDate}
            totalValue={totalValue}
            formatCurrency={formatCurrency}
            onBack={() => setStep("select-security")}
            onSubmit={handleSubmit}
            isPending={createHolding.isPending}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

export default AddHoldingModal;
