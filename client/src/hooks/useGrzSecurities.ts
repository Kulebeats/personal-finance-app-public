import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// The server responds with the V7 envelope: { success: true, data: T }.
interface ApiEnvelope<T> {
  success: true;
  data: T;
}

// Types
export interface GrzBond {
  id: string;
  bondName: string;
  isin: string | null;
  tenorYears: number;
  faceValue: string;
  purchasePrice: string;
  purchaseDate: string;
  purchaseYield: string | null;
  couponRate: string;
  couponFrequency: number;
  maturityDate: string;
  status: "active" | "matured" | "sold" | "rolled_over";
  createdAt: string;
  payments?: GrzBondPayment[];
}

export interface GrzBondPayment {
  id: string;
  paymentDate: string;
  paymentType: "coupon" | "principal";
  grossAmount: string;
  withholdingTax: string;
  netAmount: string;
  status: "scheduled" | "paid";
  actualPaymentDate: string | null;
}

export interface GrzTBill {
  id: string;
  tbillName: string;
  isin: string | null;
  tenorDays: number;
  faceValue: string;
  purchasePrice: string;
  purchaseDate: string;
  purchaseYield: string | null;
  discountAmount: string | null;
  maturityDate: string;
  status: "active" | "matured" | "sold" | "rolled_over";
  createdAt: string;
}

export const grzKeys = {
  all: ["grz"] as const,
  bonds: () => [...grzKeys.all, "bonds"] as const,
  tbills: () => [...grzKeys.all, "tbills"] as const,
};

// ============================================================================
// GRZ BONDS HOOKS
// ============================================================================

export function useGrzBonds() {
  return useQuery({
    queryKey: grzKeys.bonds(),
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/grz/bonds");
      const envelope: ApiEnvelope<GrzBond[]> = await response.json();
      return envelope.data;
    },
    select: (data) => data as GrzBond[],
  });
}

export function useCreateGrzBond() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: Partial<GrzBond>) => {
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
        description: error.message || "Failed to add bond",
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
        description: error.message || "Failed to mark payment as paid",
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
    mutationFn: async (data: Partial<GrzTBill>) => {
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
        description: error.message || "Failed to add T-Bill",
        variant: "destructive",
      });
    },
  });
}
