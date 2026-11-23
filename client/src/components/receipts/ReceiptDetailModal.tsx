import { calendarToday } from "@/lib/calendarZone";
import { useState, useMemo, useEffect } from "react";
import { withProtectedBlob, reportProtectedMediaError } from "@/lib/protected-media";
import { format, subDays, addDays, parseISO } from "date-fns";
import { Loader2 } from "lucide-react";

import { Dialog, DialogContent } from "../ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { useReceipt, useStoreOcrResults, useCreateTransactionFromReceipt, useDeleteReceipt, useMatchReceipt } from "../../hooks/useReceipts";
import { useTransactions } from "../../hooks/useTransactions";
import { useOcrProcessor } from "../../hooks/useOcrProcessor";
import { toast } from "sonner";
import { OcrExtractedData } from "@shared/schema";
import { useUserPreferences } from "../../hooks/use-settings";
import { useAccounts } from "@/hooks/useAccounts";
import { ReceiptDetailHeader } from "./ReceiptDetailHeader";
import { ReceiptImagePanel } from "./ReceiptImagePanel";
import { ReceiptDetailsTab } from "./ReceiptDetailsTab";
import { ReceiptMatchTab } from "./ReceiptMatchTab";
import { ReceiptFooter } from "./ReceiptFooter";

interface ReceiptDetailModalProps {
  receiptId: string | null;
  onOpenChange: (open: boolean) => void;
}

export function ReceiptDetailModal({
  receiptId,
  onOpenChange,
}: ReceiptDetailModalProps) {
  const [activeTab, setActiveTab] = useState("details");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTransactionId, setSelectedTransactionId] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const { data: receiptData, isLoading } = useReceipt(receiptId || "");
  const storeOcr = useStoreOcrResults();
  const createTransaction = useCreateTransactionFromReceipt();
  const deleteReceipt = useDeleteReceipt();
  const matchReceipt = useMatchReceipt();
  const { data: accounts = [], isLoading: accountsLoading } = useAccounts();

  const { data: userPrefs } = useUserPreferences();
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const selectedAccount = accounts.find(
    (account) => account.id === selectedAccountId
  );

  const hasAccounts = accounts.length > 0;

  useEffect(() => {
    if (!accountsLoading && hasAccounts && !selectedAccountId) {
      setSelectedAccountId(accounts[0].id);
    }
  }, [accountsLoading, hasAccounts, accounts, selectedAccountId]);

  const handleOcrSuccess = (
    data: OcrExtractedData,
    confidence: number,
    rawText: string
  ) => {
    if (!receiptId) return;
    storeOcr.mutate(
      {
        receiptId,
        ocrData: data,
        confidence,
        rawText,
      },
      {
        onSuccess: () => {
          toast.success("OCR processing complete");

          if (
            userPrefs?.autoCreateFromReceipt &&
            confidence >= (userPrefs.ocrConfidenceThreshold || 80)
          ) {
            handleCreateTransaction(data);
            toast.info("Transaction auto-created from receipt");
          }
        },
      }
    );
  };

  const {
    processImage,
    isProcessing: isOcrProcessing,
    status: ocrStatus,
  } = useOcrProcessor({
    onSuccess: handleOcrSuccess,
    onError: (error) => toast.error(`OCR Failed: ${error}`),
  });

  const receipt = receiptData?.data;

  const transactionDateRange = useMemo(() => {
    const ocrDate = receipt?.ocrData?.date;
    const baseDate = ocrDate ? parseISO(ocrDate) : new Date();
    return {
      startDate: format(subDays(baseDate, 14), "yyyy-MM-dd"),
      endDate: format(addDays(baseDate, 14), "yyyy-MM-dd"),
    };
  }, [receipt?.ocrData?.date]);

  const { data: transactionsData, isLoading: transactionsLoading } = useTransactions({
    startDate: transactionDateRange.startDate,
    endDate: transactionDateRange.endDate,
    limit: 100,
  });

  const filteredTransactions = useMemo(() => {
    const transactions = transactionsData?.transactions || [];
    if (!searchQuery.trim()) return transactions;
    const query = searchQuery.toLowerCase();
    return transactions.filter(
      (transaction) =>
        transaction.name.toLowerCase().includes(query) ||
        transaction.originalName?.toLowerCase().includes(query)
    );
  }, [transactionsData?.transactions, searchQuery]);

  const handleMatchTransaction = () => {
    if (!receiptId || !selectedTransactionId) return;
    matchReceipt.mutate(
      { receiptId, transactionId: selectedTransactionId },
      {
        onSuccess: () => {
          setSelectedTransactionId(null);
          onOpenChange(false);
        },
      }
    );
  };

  const handleToggleTransaction = (transactionId: string) => {
    setSelectedTransactionId((current) =>
      current === transactionId ? null : transactionId
    );
  };

  const handleRunOcr = () => receipt && void withProtectedBlob(
    receipt.imageUrl, processImage,
  ).catch(reportProtectedMediaError);

  const handleCreateTransaction = (data: OcrExtractedData) => {
    if (!receiptId) return;

    if (!selectedAccountId) {
      toast.error("Select an account before creating a transaction.");
      return;
    }

    createTransaction.mutate({
      receiptId,
      data: {
        accountId: selectedAccountId,
        name: data.merchantName || "Unknown Merchant",
        amount: data.amount || "0",
        date: data.date || calendarToday(),
        notes: "Created from receipt scan",
      },
    });
  };

  const handleDeleteClick = () => {
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = () => {
    if (!receiptId) return;
    deleteReceipt.mutate(receiptId, {
      onSuccess: () => {
        setDeleteDialogOpen(false);
        onOpenChange(false);
      },
    });
  };

  if (!receiptId) return null;

  return (
    <Dialog open={!!receiptId} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[85vh] flex flex-col p-0 gap-0">
        <ReceiptDetailHeader receipt={receipt} />

        {isLoading ? (
          <div
            className="flex-1 flex items-center justify-center"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">Loading receipt details...</span>
          </div>
        ) : receipt ? (
          <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
            <ReceiptImagePanel
              receipt={receipt}
              onRunOcr={handleRunOcr}
              isOcrProcessing={isOcrProcessing}
              ocrStatus={ocrStatus}
            />

            <div className="w-full md:w-1/2 flex flex-col bg-background">
              <Tabs
                value={activeTab}
                onValueChange={setActiveTab}
                className="flex-1 flex flex-col"
              >
                <div className="px-6 py-2 border-b">
                  <TabsList className="w-full grid grid-cols-2">
                    <TabsTrigger value="details">Extracted Data</TabsTrigger>
                    <TabsTrigger value="match">Match Transaction</TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent value="details" className="flex-1 p-6 overflow-auto">
                  <ReceiptDetailsTab
                    receipt={receipt}
                    accounts={accounts}
                    accountsLoading={accountsLoading}
                    hasAccounts={hasAccounts}
                    selectedAccountId={selectedAccountId}
                    onAccountChange={setSelectedAccountId}
                    onRunOcr={handleRunOcr}
                    onCreateTransaction={handleCreateTransaction}
                    isCreatingTransaction={createTransaction.isPending}
                  />
                </TabsContent>

                <TabsContent
                  value="match"
                  className="flex-1 p-6 overflow-hidden flex flex-col"
                >
                  <ReceiptMatchTab
                    searchQuery={searchQuery}
                    onSearchQueryChange={setSearchQuery}
                    transactionDateRange={transactionDateRange}
                    transactionsLoading={transactionsLoading}
                    filteredTransactions={filteredTransactions}
                    selectedTransactionId={selectedTransactionId}
                    onToggleTransaction={handleToggleTransaction}
                    onMatchTransaction={handleMatchTransaction}
                    isMatching={matchReceipt.isPending}
                    receiptAmount={receipt.ocrData?.amount}
                    receiptCurrency={receipt.ocrData?.currency}
                  />
                </TabsContent>
              </Tabs>

              <ReceiptFooter
                activeTab={activeTab}
                receipt={receipt}
                selectedAccountId={selectedAccountId}
                onDelete={handleDeleteClick}
                onCreateTransaction={handleCreateTransaction}
              />
            </div>
          </div>
        ) : (
          <div className="p-8 text-center text-muted-foreground">
            Receipt not found
          </div>
        )}
      </DialogContent>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Receipt?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The receipt and any extracted data
              will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteReceipt.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
