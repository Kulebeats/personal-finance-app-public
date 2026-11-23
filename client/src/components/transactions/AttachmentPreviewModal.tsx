import { useState, useEffect } from "react";
import { downloadProtectedResource, reportProtectedMediaError, useProtectedObjectUrl } from "@/lib/protected-media";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  File,
  FileText,
  ImageIcon,
} from "lucide-react";
import type { Attachment } from "@/hooks/useAttachments";

interface AttachmentPreviewModalProps {
  transactionId: string;
  attachments: Attachment[];
  initialIndex: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function FileIcon({ mimeType, className }: { mimeType: string; className?: string }) {
  if (mimeType.startsWith("image/")) {
    return <ImageIcon className={className} />;
  }
  if (mimeType === "application/pdf") {
    return <FileText className={className} />;
  }
  return <File className={className} />;
}

export function AttachmentPreviewModal({
  transactionId,
  attachments,
  initialIndex,
  open,
  onOpenChange,
}: AttachmentPreviewModalProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [imageLoading, setImageLoading] = useState(true);
  const [pdfError, setPdfError] = useState(false);

  const currentAttachment = attachments[currentIndex];
  const isImage = currentAttachment?.mimeType.startsWith("image/");
  const isPdf = currentAttachment?.mimeType === "application/pdf";
  const source = open && currentAttachment ? `/api/transactions/${transactionId}/attachments/${currentAttachment.id}/download` : null;
  const { url: previewUrl, error: previewError } = useProtectedObjectUrl(source);

  // Navigation handlers
  const goToNext = () => {
    setCurrentIndex((prev) => (prev + 1) % attachments.length);
  };

  const goToPrevious = () => {
    setCurrentIndex((prev) => (prev - 1 + attachments.length) % attachments.length);
  };

  // Keyboard event handler
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          goToPrevious();
          break;
        case "ArrowRight":
          e.preventDefault();
          goToNext();
          break;
        case "Escape":
          onOpenChange(false);
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, attachments.length]);

  // Reset loading state when attachment changes
  useEffect(() => {
    setImageLoading(true);
    setPdfError(false);
  }, [currentIndex]);

  // Reset current index when modal opens with new initialIndex
  useEffect(() => {
    if (open) {
      setCurrentIndex(initialIndex);
    }
  }, [open, initialIndex]);

  // Download handler
  const handleDownload = () => {
    const url = `/api/transactions/${transactionId}/attachments/${currentAttachment.id}/download`;
    void downloadProtectedResource(url, currentAttachment.originalFilename).catch(reportProtectedMediaError);
  };

  if (!currentAttachment) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] max-h-[95vh] w-full h-full p-0 gap-0">
        {/* Header with controls */}
        <div className="flex items-center justify-between p-4 border-b bg-background">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <FileIcon
              mimeType={currentAttachment.mimeType}
              className="w-5 h-5 shrink-0"
            />
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-medium truncate">
                {currentAttachment.originalFilename}
              </span>
              <span className="text-xs text-muted-foreground">
                {(currentAttachment.size / 1024).toFixed(1)} KB
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Navigation buttons - only show if multiple attachments */}
            {attachments.length > 1 && (
              <>
                <span className="text-sm text-muted-foreground px-2">
                  {currentIndex + 1} / {attachments.length}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={goToPrevious}
                  title="Previous (←)"
                  aria-label="Previous attachment"
                >
                  <ChevronLeft className="w-5 h-5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={goToNext}
                  title="Next (→)"
                  aria-label="Next attachment"
                >
                  <ChevronRight className="w-5 h-5" />
                </Button>
                <Separator orientation="vertical" className="h-6" />
              </>
            )}

            <Button
              variant="ghost"
              size="icon"
              onClick={handleDownload}
              title="Download"
              aria-label="Download attachment"
            >
              <Download className="w-5 h-5" />
            </Button>
          </div>
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-hidden bg-muted/30 flex items-center justify-center relative">
          {previewError && <p role="alert">{previewError.message}</p>}
          {isImage && (
            <>
              {imageLoading && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
              )}
              {previewUrl && <img
                src={previewUrl}
                alt={currentAttachment.originalFilename}
                className="max-w-full max-h-full object-contain"
                onLoad={() => setImageLoading(false)}
                onError={() => setImageLoading(false)}
              />}
            </>
          )}

          {isPdf && (
            <>
              {pdfError ? (
                <div className="text-center p-8">
                  <p className="text-muted-foreground mb-4">
                    Unable to preview PDF in browser
                  </p>
                  <Button onClick={handleDownload} variant="outline">
                    <Download className="w-4 h-4 mr-2" />
                    Download to view
                  </Button>
                </div>
              ) : previewUrl ? (
                <iframe
                  src={`${previewUrl}#view=FitH`}
                  className="w-full h-full border-0"
                  title={currentAttachment.originalFilename}
                  onError={() => setPdfError(true)}
                />
              ) : <p role="status">Loading attachment…</p>}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
