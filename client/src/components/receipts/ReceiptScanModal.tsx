import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, X, FileText, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Button } from "../ui/button";
import { Progress } from "../ui/progress";
import { useUploadReceipt } from "../../hooks/useReceipts";
import { toast } from "sonner";

interface ReceiptScanModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploadSuccess?: (receiptId: string) => void;
}

export function ReceiptScanModal({
  open,
  onOpenChange,
  onUploadSuccess,
}: ReceiptScanModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const uploadReceipt = useUploadReceipt();

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const selected = acceptedFiles[0];
    if (selected) {
      setFile(selected);
      setPreview(URL.createObjectURL(selected));
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "image/jpeg": [],
      "image/png": [],
      "image/webp": [],
    },
    maxFiles: 1,
    maxSize: 10 * 1024 * 1024, // 10MB
  });

  const handleUpload = async () => {
    if (!file) return;

    setUploading(true);
    // Simulate progress for better UX
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 90) {
          clearInterval(interval);
          return 90;
        }
        return prev + 10;
      });
    }, 200);

    try {
      const result = await uploadReceipt.mutateAsync({ file });

      setProgress(100);
      toast.success("Receipt uploaded successfully");

      if (result.success) {
        onUploadSuccess?.(result.data.receiptId);
        handleClose();
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to upload receipt";
      toast.error(message);
      if ((err as { status?: number }).status === 401) {
        window.location.href = "/login";
      }
      setProgress(0);
    } finally {
      clearInterval(interval);
      setUploading(false);
    }
  };

  const handleClose = () => {
    setFile(null);
    setPreview(null);
    setProgress(0);
    setUploading(false);
    onOpenChange(false);
  };

  const removeFile = (e: React.MouseEvent) => {
    e.stopPropagation();
    setFile(null);
    setPreview(null);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Scan Receipt</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {!file ? (
            <div
              {...getRootProps()}
              className={`
                border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors
                ${
                  isDragActive
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50 hover:bg-muted/50"
                }
              `}
            >
              <input {...getInputProps()} />
              <div className="flex flex-col items-center gap-2">
                <div className="p-3 bg-muted rounded-full">
                  <Upload className="h-6 w-6 text-muted-foreground" />
                </div>
                <div className="text-sm font-medium">
                  {isDragActive
                    ? "Drop receipt here"
                    : "Drag & drop or click to upload"}
                </div>
                <div className="text-xs text-muted-foreground">
                  Supported: JPG, PNG, WebP (max 10MB)
                </div>
              </div>
            </div>
          ) : (
            <div className="relative rounded-lg border bg-muted p-4">
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1 h-11 w-11 rounded-full"
                onClick={removeFile}
                aria-label="Remove uploaded file"
              >
                <X className="h-5 w-5" />
              </Button>

              <div className="flex items-center gap-4">
                <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-md border bg-background flex items-center justify-center">
                  {preview ? (
                    <img
                      src={preview}
                      alt={`Preview of uploaded receipt: ${file.name}`}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <FileText className="h-6 w-6 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
              </div>

              {uploading && (
                <div
                  className="mt-4 space-y-2"
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Uploading...</span>
                    <span aria-hidden="true">{progress}%</span>
                  </div>
                  <Progress value={progress} className="h-1" aria-label={`Upload progress: ${progress}%`} />
                  <span className="sr-only">Upload progress: {progress} percent</span>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={handleClose}
              disabled={uploading}
            >
              Cancel
            </Button>
            <Button onClick={handleUpload} disabled={!file || uploading}>
              {uploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {uploading ? "Uploading..." : "Upload & Scan"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
