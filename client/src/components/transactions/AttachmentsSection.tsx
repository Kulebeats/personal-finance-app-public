import { useState } from "react";
import { Paperclip, Upload, Trash2, Download, File, FileText, ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useAttachments,
  useUploadAttachment,
  useDeleteAttachment,
} from "@/hooks/useAttachments";
import { AttachmentPreviewModal } from "./AttachmentPreviewModal";
import { cn } from "@/lib/utils";

interface AttachmentsSectionProps {
  transactionId: string;
}

export function AttachmentsSection({ transactionId }: AttachmentsSectionProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const { data: attachments, isLoading } = useAttachments(transactionId);
  const uploadMutation = useUploadAttachment(transactionId);
  const deleteMutation = useDeleteAttachment(transactionId);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Client-side validation
    const validTypes = [
      "image/jpeg",
      "image/png",
      "image/jpg",
      "application/pdf",
    ];
    if (!validTypes.includes(file.type)) {
      alert("Invalid file type. Only JPG, PNG, and PDF are allowed.");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      alert("File too large. Maximum size is 5MB.");
      return;
    }

    setIsUploading(true);
    try {
      await uploadMutation.mutateAsync(file);
    } finally {
      setIsUploading(false);
      e.target.value = ""; // Reset input
    }
  };

  const handleDownload = (attachmentId: string, filename: string) => {
    const url = `/api/transactions/${transactionId}/attachments/${attachmentId}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handlePreview = (index: number) => {
    setPreviewIndex(index);
    setPreviewOpen(true);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium flex items-center gap-2">
          <Paperclip className="w-4 h-4" />
          Attachments
        </label>
        <label className="cursor-pointer">
          <input
            type="file"
            accept=".jpg,.jpeg,.png,.pdf"
            onChange={handleFileChange}
            className="hidden"
            disabled={isUploading}
          />
          <Button variant="outline" size="sm" disabled={isUploading} asChild>
            <span>
              <Upload className="w-4 h-4 mr-2" />
              {isUploading ? "Uploading..." : "Upload"}
            </span>
          </Button>
        </label>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading...</div>
      ) : attachments && attachments.length > 0 ? (
        <div className="space-y-2">
          {attachments.map((attachment, index) => {
            const isImage = attachment.mimeType.startsWith("image/");
            const isPdf = attachment.mimeType === "application/pdf";
            const canPreview = isImage || isPdf;

            return (
              <div
                key={attachment.id}
                className={cn(
                  "flex items-center justify-between p-2 border rounded-lg transition-colors",
                  canPreview && "hover:bg-muted/50 cursor-pointer"
                )}
                onClick={() => canPreview && handlePreview(index)}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {/* Thumbnail for images */}
                  {isImage ? (
                    <div className="w-12 h-12 rounded overflow-hidden shrink-0 bg-muted border">
                      <img
                        src={`/api/transactions/${transactionId}/attachments/${attachment.id}/download`}
                        alt={attachment.originalFilename}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ) : isPdf ? (
                    <div className="w-12 h-12 rounded flex items-center justify-center shrink-0 bg-muted border">
                      <FileText className="w-6 h-6 text-muted-foreground" />
                    </div>
                  ) : (
                    <File className="w-4 h-4 text-muted-foreground shrink-0" />
                  )}

                  <div className="flex flex-col min-w-0">
                    <span className="text-sm truncate">
                      {attachment.originalFilename}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {(attachment.size / 1024).toFixed(1)} KB
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDownload(attachment.id, attachment.originalFilename);
                    }}
                    className="h-8 w-8"
                    title="Download"
                  >
                    <Download className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteMutation.mutate(attachment.id);
                    }}
                    disabled={deleteMutation.isPending}
                    className="h-8 w-8 hover:text-destructive"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-sm text-muted-foreground text-center py-4 border border-dashed rounded-lg">
          No attachments yet
        </div>
      )}

      <AttachmentPreviewModal
        transactionId={transactionId}
        attachments={attachments || []}
        initialIndex={previewIndex}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
      />
    </div>
  );
}
