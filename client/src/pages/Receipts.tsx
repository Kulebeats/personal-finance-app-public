import { useState } from "react";
import { format } from "date-fns";
import { Upload, Search, Loader2, Inbox } from "lucide-react";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ReceiptScanModal } from "@/components/receipts/ReceiptScanModal";
import { ReceiptDetailModal } from "@/components/receipts/ReceiptDetailModal";
import { useReceipts } from "@/hooks/useReceipts";
import { formatCurrency } from "@/lib/format";
import { parseMoneyInputNumber } from "@/lib/money";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

export default function Receipts() {
  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [selectedReceipt, setSelectedReceipt] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearch = useDebouncedValue(searchQuery, 300);

  const { data: receiptsData, isLoading } = useReceipts({
    status: filter,
    search: debouncedSearch || undefined,
    limit: 50,
  });

  const getStatusBadge = (status: string, ocrStatus: string) => {
    if (status === "matched") {
      return (
        <Badge
          variant="secondary"
          className="bg-blue-100 text-blue-800 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300"
        >
          Matched
        </Badge>
      );
    }
    if (ocrStatus === "pending") {
      return (
        <Badge
          variant="outline"
          className="border-yellow-500 text-yellow-600 dark:text-yellow-400"
        >
          Scanning
        </Badge>
      );
    }
    if (ocrStatus === "completed") {
      return (
        <Badge
          variant="secondary"
          className="bg-green-100 text-green-800 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-300"
        >
          Ready
        </Badge>
      );
    }
    return <Badge variant="outline">Pending</Badge>;
  };

  return (
    <Layout>
      <div className="flex flex-col gap-6 p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Receipts</h1>
            <p className="text-muted-foreground">
              Scan and organize your receipts to automatically match
              transactions.
            </p>
          </div>
          <Button onClick={() => setScanModalOpen(true)}>
            <Upload className="mr-2 h-4 w-4" />
            Scan Receipt
          </Button>
        </div>

        <Card>
          <CardHeader className="py-4 px-6 border-b flex flex-row items-center justify-between space-y-0">
            <div className="flex items-center gap-2 flex-1">
              <Search
                className="h-4 w-4 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                placeholder="Search receipts..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="max-w-xs border-0 shadow-none focus-visible:ring-0"
                aria-label="Search receipts by merchant name or filename"
              />
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant={filter === "all" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setFilter("all")}
              >
                All
              </Button>
              <Button
                variant={filter === "matched" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setFilter("matched")}
              >
                Matched
              </Button>
              <Button
                variant={filter === "pending" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setFilter("pending")}
              >
                Pending
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div
                className="flex items-center justify-center py-20"
                role="status"
                aria-live="polite"
              >
                <Loader2
                  className="h-8 w-8 animate-spin text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="sr-only">Loading receipts...</span>
              </div>
            ) : receiptsData?.data && receiptsData.data.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-6">
                {receiptsData.data.map((receipt) => {
                  const ocrData = receipt.ocrData ?? undefined;
                  const merchantName =
                    ocrData?.merchantName || "Unknown Merchant";
                  const amount = ocrData?.amount;
                  const currency = ocrData?.currency || "USD";
                  const amountValue = parseMoneyInputNumber(amount);
                  const dateStr = format(
                    new Date(receipt.createdAt),
                    "MMM d, yyyy",
                  );
                  const formattedAmount = amountValue !== null
                    ? formatCurrency(amountValue, currency)
                    : "";

                  return (
                    <button
                      key={receipt.id}
                      type="button"
                      onClick={() => setSelectedReceipt(receipt.id)}
                      className="group relative border rounded-lg overflow-hidden cursor-pointer hover:border-primary/50 transition-all shadow-sm hover:shadow-md bg-card text-left w-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      aria-label={`View receipt from ${merchantName}${formattedAmount ? `, ${formattedAmount}` : ""}, uploaded ${dateStr}`}
                    >
                      <div className="aspect-3/4 bg-muted relative overflow-hidden">
                        <ProtectedImage
                          src={receipt.thumbnailUrl ?? receipt.imageUrl}
                          alt={`Receipt from ${merchantName}${formattedAmount ? ` for ${formattedAmount}` : ""}`}
                          className="w-full h-full object-cover transition-transform group-hover:scale-105"
                          loading="lazy"
                        />
                        <div className="absolute top-2 right-2">
                          {getStatusBadge(
                            receipt.matchStatus,
                            receipt.ocrStatus,
                          )}
                        </div>
                      </div>
                      <div className="p-3">
                        <div className="font-medium truncate">
                          {merchantName}
                        </div>
                        <div className="flex justify-between items-center mt-1 text-sm text-muted-foreground">
                          <span>{dateStr}</span>
                          {formattedAmount && (
                            <span className="font-semibold text-foreground">
                              {formattedAmount}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                icon={Inbox}
                title="No receipts found"
                description="Upload your first receipt to start tracking expenses automatically."
                primaryAction={{
                  label: "Scan Receipt",
                  onClick: () => setScanModalOpen(true),
                }}
                testId="receipts-empty-state"
              />
            )}
          </CardContent>
        </Card>
      </div>

      <ReceiptScanModal
        open={scanModalOpen}
        onOpenChange={setScanModalOpen}
        onUploadSuccess={(id) => setSelectedReceipt(id)}
      />

      <ReceiptDetailModal
        receiptId={selectedReceipt}
        onOpenChange={(open) => !open && setSelectedReceipt(null)}
      />
    </Layout>
  );
}
import { ProtectedImage } from "@/components/session/ProtectedImage";
