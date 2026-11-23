import React from "react";
import { Download, FileJson, Loader2 } from "lucide-react";
import { SettingsCard } from "@/features/settings/components/SettingsCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useDownloadPersonalExport,
  usePersonalExports,
  useRequestPersonalExport,
} from "@/hooks/usePersonalDataExport";
import type { PersonalExportItem, PersonalExportStatus } from "@shared/personal-data-export";

const STATUS_LABEL: Record<PersonalExportStatus, string> = {
  ready: "Ready",
  expired: "Expired",
  failed: "Failed",
  revoked: "No longer available",
};

const formatDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "Unknown";

interface ExportRowProps {
  item: PersonalExportItem;
  isDownloading: boolean;
  onDownload: (item: PersonalExportItem) => void;
}

function ExportRow({ item, isDownloading, onDownload }: Readonly<ExportRowProps>) {
  return (
    <li className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
      <FileJson className="w-5 h-5 text-muted-foreground shrink-0" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">Requested {formatDate(item.createdAt)}</p>
        <p className="text-xs text-muted-foreground">
          {item.status === "ready" ? `Available until ${formatDate(item.expiresAt)}` : STATUS_LABEL[item.status]}
          {item.recordCount !== null ? ` · ${item.recordCount} records` : ""}
        </p>
      </div>
      <Badge variant={item.status === "ready" ? "secondary" : "outline"}>{STATUS_LABEL[item.status]}</Badge>
      {item.status === "ready" && (
        <Button
          size="sm"
          variant="outline"
          disabled={isDownloading}
          onClick={() => onDownload(item)}
          aria-label={`Download the export requested ${formatDate(item.createdAt)}`}
        >
          <Download className="w-4 h-4 mr-1" aria-hidden="true" />
          Download
        </Button>
      )}
    </li>
  );
}

/** Request and download a copy of your own data (DPA right of access). */
export function PersonalDataExportCard() {
  const { data: exports, isLoading, isError } = usePersonalExports();
  const requestExport = useRequestPersonalExport();
  const download = useDownloadPersonalExport();

  return (
    <SettingsCard
      title="Your data"
      description="Download a copy of your profile and the household data you can see as one ZIP file: a JSON document plus a CSV sheet for each section, covering accounts, transactions, categories, goals, budgets, recurring rules, investment holdings, government bonds and treasury bills, receipt details and tags. Other members' private data is never included. Each file can be downloaded for 7 days."
      action={
        <Button onClick={() => requestExport.mutate()} disabled={requestExport.isPending}>
          {requestExport.isPending ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
          ) : (
            <Download className="w-4 h-4 mr-2" aria-hidden="true" />
          )}
          {requestExport.isPending ? "Preparing export…" : "Export my data"}
        </Button>
      }
    >
      {isLoading ? (
        <Skeleton className="h-12 w-full" />
      ) : isError ? (
        <p className="text-sm text-destructive py-2" role="alert">
          Your previous exports could not be loaded.
        </p>
      ) : !exports || exports.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">You have not exported your data yet.</p>
      ) : (
        <ul className="space-y-2" aria-label="Your data exports">
          {exports.slice(0, 5).map((item) => (
            <ExportRow
              key={item.id}
              item={item}
              isDownloading={download.isPending && download.variables?.id === item.id}
              onDownload={(selected) => download.mutate(selected)}
            />
          ))}
        </ul>
      )}
    </SettingsCard>
  );
}
