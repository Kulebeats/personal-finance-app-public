import { userErrorMessage } from "@/lib/errorCopy";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { MoneyDto } from "@shared/money";

// The server responds with the V7 envelope: { success: true, data: T }.
interface ApiEnvelope<T> {
  success: true;
  data: T;
  meta?: { policy?: GrzPolicyDefaults };
}

/** NEW-35: the conventions the server applies today, labelled as policy
 * defaults pending OI-03. None is a claim about current GRZ rules. */
export interface GrzPolicyDefault { rule: string; value: string }
export interface GrzPolicyDefaults {
  status: "policy_default_pending_OI-03";
  label: string;
  couponWithholding: GrzPolicyDefault;
  tbillDiscountWithholding: GrzPolicyDefault;
  principalWithholding: GrzPolicyDefault;
  bondSaleWithholding: GrzPolicyDefault;
  tbillYieldDayBasis: GrzPolicyDefault;
  auctionYieldDayBasis: GrzPolicyDefault;
  accruedInterestDayCount: GrzPolicyDefault;
}

// Types
export interface GrzBond {
  id: string;
  accountId?: string | null;
  bondName: string;
  isin: string | null;
  tenorYears: number;
  faceValue: MoneyDto;
  purchasePrice: MoneyDto;
  purchaseDate: string;
  purchaseYield: string | null;
  couponRate: string;
  couponFrequency: number;
  maturityDate: string;
  status: "active" | "matured" | "sold" | "rolled_over";
  soldPrice?: MoneyDto | null;
  saleFees?: MoneyDto | null;
  saleCostBasis?: MoneyDto | null;
  saleRealizedGain?: MoneyDto | null;
  createdAt: string;
  payments?: GrzBondPayment[];
}

export interface GrzBondPayment {
  id: string;
  paymentDate: string;
  paymentType: "coupon" | "principal";
  grossAmount: MoneyDto;
  withholdingTax: MoneyDto | null;
  netAmount: MoneyDto;
  status: "scheduled" | "paid";
  actualPaymentDate: string | null;
}

export interface GrzTBill {
  id: string;
  /** The settlement account its maturity pays into (A-42). */
  accountId?: string | null;
  tbillName: string;
  isin: string | null;
  tenorDays: number;
  faceValue: MoneyDto;
  purchasePrice: MoneyDto;
  purchaseDate: string;
  purchaseYield: string | null;
  discountAmount: MoneyDto | null;
  maturityDate: string;
  /** awaiting_receipt: due, held at face less withholding until the member confirms the bank credit (A-36). */
  status: "active" | "awaiting_receipt" | "matured" | "sold" | "rolled_over";
  maturityWithholdingTax?: MoneyDto | null;
  maturityNetProceeds?: MoneyDto | null;
  settlementReceiptDate?: string | null;
  createdAt: string;
}

/** Request bodies send amounts as decimal strings; responses answer MoneyDto. */
type MoneyFieldsAsStrings<T, K extends keyof T> = Omit<T, K> & { [P in K]?: string | null };
export type GrzBondInput = Partial<MoneyFieldsAsStrings<GrzBond, "faceValue" | "purchasePrice">>;
export type GrzTBillInput = Partial<MoneyFieldsAsStrings<GrzTBill, "faceValue" | "purchasePrice" | "discountAmount">>;

export const grzKeys = {
  all: ["grz"] as const,
  bonds: () => [...grzKeys.all, "bonds"] as const,
  tbills: () => [...grzKeys.all, "tbills"] as const,
};

// ============================================================================
// GRZ BONDS HOOKS
// ============================================================================

// The list query keeps the envelope's policy beside the rows, so one request
// serves both the list and its labelled policy defaults.
interface GrzBondList { items: GrzBond[]; policy: GrzPolicyDefaults | null }

const bondListQuery = {
  queryKey: grzKeys.bonds(),
  queryFn: async (): Promise<GrzBondList> => {
    const response = await apiRequest("GET", "/api/grz/bonds");
    const envelope: ApiEnvelope<GrzBond[]> = await response.json();
    return { items: envelope.data, policy: envelope.meta?.policy ?? null };
  },
};

export function useGrzBonds() {
  return useQuery({ ...bondListQuery, select: (list: GrzBondList) => list.items });
}

/** The GRZ conventions in use, each labelled "Policy default, pending OI-03". */
export function useGrzPolicy() {
  return useQuery({ ...bondListQuery, select: (list: GrzBondList) => list.policy });
}

export function useCreateGrzBond() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: GrzBondInput) => {
      const response = await apiRequest("POST", "/api/grz/bonds", data);
      const envelope: ApiEnvelope<GrzBond> = await response.json();
      return envelope.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: grzKeys.bonds() });
      toast({
        title: "Bond Record Added",
        description: "Your GRZ bond has been recorded.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: userErrorMessage(error, "Failed to add bond"),
        variant: "destructive",
      });
    },
  });
}

export function useMarkGrzPaymentPaid() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      id,
      accountId,
      date,
    }: {
      id: string;
      accountId: string;
      date?: string;
    }) => {
      const response = await apiRequest("POST", `/api/grz/payments/${id}/pay`, {
        accountId,
        date,
      });
      const envelope: ApiEnvelope<GrzBondPayment> = await response.json();
      return envelope.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: grzKeys.bonds() });
      toast({
        title: "Payment Recorded",
        description: "Bond coupon marked as paid and income recorded.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: userErrorMessage(error, "Failed to mark payment as paid"),
        variant: "destructive",
      });
    },
  });
}

// ============================================================================
// GRZ T-BILLS HOOKS
// ============================================================================

export function useGrzTBills() {
  return useQuery({
    queryKey: grzKeys.tbills(),
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/grz/tbills");
      const envelope: ApiEnvelope<GrzTBill[]> = await response.json();
      return envelope.data;
    },
    select: (data) => data as GrzTBill[],
  });
}

export function useCreateGrzTBill() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: GrzTBillInput) => {
      const response = await apiRequest("POST", "/api/grz/tbills", data);
      const envelope: ApiEnvelope<GrzTBill> = await response.json();
      return envelope.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: grzKeys.tbills() });
      toast({
        title: "T-Bill Record Added",
        description: "Your Treasury Bill has been recorded.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: userErrorMessage(error, "Failed to add T-Bill"),
        variant: "destructive",
      });
    },
  });
}
