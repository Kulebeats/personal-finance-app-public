import { useState, useEffect, useRef } from "react";
import Decimal from "decimal.js";
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
import { useHouseholdDateDefault } from "@/lib/calendarZone";
import { useFormat } from "@/hooks/use-format";
import type { CreateHoldingInput } from "@/hooks/investments/useHoldings";
import { useSession } from "@/contexts/SessionContext";
import { generateIdempotencyKey } from "@/lib/api";
import { assertOperationLifetime, captureOperationLifetime, type OperationLifetime } from "@/lib/operation-lifetime";
import type { SecurityType, SecurityExchange } from "../types";

import { AddHoldingDetailsStep } from "./AddHoldingDetailsStep";
import { AddHoldingNewSecurityStep } from "./AddHoldingNewSecurityStep";
import { AddHoldingSecurityStep } from "./AddHoldingSecurityStep";

const OpeningDecimal = Decimal.clone({ precision: 48, rounding: Decimal.ROUND_HALF_UP });
const openingNumber = /^(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/i;
function calculateOpening(quantity: string, price: string) {
  if (!openingNumber.test(quantity) || !openingNumber.test(price)) return null;
  try {
    const shares = new OpeningDecimal(quantity), unitPrice = new OpeningDecimal(price);
    // Unlike a trade, an opening may declare a zero-share shell or a zero-cost gift.
    if (!shares.isFinite() || shares.gte("1e10") || shares.dp() > 8 ||
        !unitPrice.isFinite() || unitPrice.gte("1e11") || unitPrice.dp() > 4) return null;
    const amount = shares.times(unitPrice).toDecimalPlaces(2);
    if (amount.gte("1e13")) return null;
    return { quantity: shares.toFixed(), amount: amount.toFixed(2) };
  } catch {
    return null;
  }
}

interface AddHoldingModalProps {
  children?: React.ReactNode;
  onSuccess?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
}
function validOpeningDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.getUTCFullYear() > 0 && date.toISOString().slice(0, 10) === value;
}

type Step = "select-security" | "enter-details";

export function AddHoldingModal(props: AddHoldingModalProps) {
  const { status, lifetime } = useSession();
  const operation = lifetime?.operation;
  if (status?.state !== "ready" || !operation?.active || !operation.expectations || operation.expectations.subject !== status.subject.id ||
      operation.expectations.household !== status.household.id) return null;
  return <OpeningHoldingForm key={operation.id} lifetime={operation} {...props} />;
}

function OpeningHoldingForm({ children, onSuccess, lifetime, open: controlledOpen, onOpenChange, onCloseAutoFocus }: AddHoldingModalProps & { lifetime: OperationLifetime }) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen, setOpen = onOpenChange ?? setLocalOpen;
  const [step, setStep] = useState<Step>("select-security");
  const attempt = useRef<Readonly<CreateHoldingInput> | null>(null), submitting = useRef(false);
  const [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSecurityId, setSelectedSecurityId] = useState<string | null>(
    null
  );
  const [securityCurrency, setSecurityCurrency] = useState<string | null>(null);
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
  // NEW-15: the server's day, UTC for a legacy household, computed when the form resets.
  const { date: purchaseDate, choose: setPurchaseDate, hold: holdDate, reset: resetDate } = useHouseholdDateDefault();

  const { formatCurrency } = useFormat();
  const { data: securities = [], isLoading: loadingSecurities, isError: securitiesError, refetch: refetchSecurities } = useSecurities(
    { search: searchQuery }
  );
  const { data: accounts = [] } = useAccounts();
  const createHolding = useCreateHolding();
  const createSecurity = useCreateSecurity();

  const investmentAccounts =
    accounts.filter((account) => account.type === "investment") || accounts;

  const resetForm = () => {
    setValidationError(null);
    setStep("select-security");
    setSearchQuery("");
    setSelectedSecurityId(null);
    setSecurityCurrency(null);
    setIsCreatingNew(false);
    setNewSymbol("");
    setNewName("");
    setNewType("stock");
    setNewExchange("luse");
    setNewCurrency("ZMW");
    setAccountId(investmentAccounts[0]?.id || "");
    setQuantity("");
    setPurchasePrice("");
    resetDate();
  };
  useEffect(() => { if (open && !attempt.current && !validationError) resetForm(); }, [open]);

  const handleSecuritySelect = (securityId: string) => {
    setSelectedSecurityId(securityId);
    setSecurityCurrency(securities.find(security => security.id === securityId)?.currency ?? null);
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
      setSecurityCurrency(result.data.currency ?? null);
      setIsCreatingNew(false);
      setStep("enter-details");
    } catch (error) {
      // Error handled by hook
    }
  };

  const validCurrency = !!securityCurrency && /^[A-Z]{3}$/.test(securityCurrency);
  // One rounded native amount is shared by the preview and submitted declaration.
  const opening = validCurrency ? calculateOpening(quantity, purchasePrice) : null;
  const validDate = validOpeningDate(purchaseDate);

  const handleSubmit = async () => {
    if (submitting.current) return;
    try { assertOperationLifetime(lifetime); } catch { return; }
    if (!attempt.current) {
      if (!selectedSecurityId || !accountId || !opening || !securityCurrency || !validDate) return;
      attempt.current = Object.freeze({ operationId: generateIdempotencyKey(), expectedCurrency: securityCurrency,
        securityId: selectedSecurityId, accountId, quantity: opening.quantity, costBasis: opening.amount, acquiredDate: purchaseDate });
      holdDate(); // the retained attempt carries this date: a late zone must not move it
    }
    const request = attempt.current;
    submitting.current = true; setPending(true); setUncertain(false); setValidationError(null);

    try {
      await createHolding.mutateAsync(request);
      assertOperationLifetime(lifetime);
      if (attempt.current !== request) return;
      attempt.current = null;
      setOpen(false);
      onSuccess?.();
    } catch (error) {
      if (lifetime.active && captureOperationLifetime() === lifetime && attempt.current === request) {
        const failure = error as { status?: number; code?: string };
        if (failure?.status === 400 && failure.code === "VALIDATION_ERROR") {
          attempt.current = null;
          setValidationError(error instanceof Error ? error.message : "Check the opening declaration.");
        } else setUncertain(true);
      }
    } finally {
      if (lifetime.active && captureOperationLifetime() === lifetime) { submitting.current = false; setPending(false); }
    }
  };
  const startNewOpening = () => {
    if (submitting.current) return;
    try { assertOperationLifetime(lifetime); } catch { return; }
    attempt.current = null; setUncertain(false); resetForm();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent className="sm:max-w-[500px]" onCloseAutoFocus={onCloseAutoFocus}>
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
            pricesUnavailable={securitiesError}
            onRetryPrices={() => { void refetchSecurities(); }}
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
            onAccountChange={value => { if (!attempt.current) setAccountId(value); }}
            investmentAccounts={investmentAccounts}
            quantity={quantity}
            onQuantityChange={value => { if (!attempt.current) setQuantity(value); }}
            purchasePrice={purchasePrice}
            onPurchasePriceChange={value => { if (!attempt.current) setPurchasePrice(value); }}
            purchaseDate={purchaseDate}
            onPurchaseDateChange={value => { if (!attempt.current) setPurchaseDate(value); }}
            totalCost={opening?.amount ?? null}
            securityCurrency={validCurrency ? securityCurrency : null}
            formatCurrency={formatCurrency}
            onBack={() => { if (!attempt.current) setStep("select-security"); }}
            onSubmit={handleSubmit}
            isPending={pending || createHolding.isPending}
            locked={attempt.current !== null}
            uncertain={uncertain}
            onStartNew={startNewOpening}
            validDate={validDate}
            validationError={validationError}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

export default AddHoldingModal;
