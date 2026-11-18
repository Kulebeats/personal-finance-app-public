import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { useUploadAttachment } from "./useAttachments";

const VALID_TYPES = ["image/jpeg", "image/png", "application/pdf"];
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

export function useTransactionAttachments() {
  const [attachments, setAttachments] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadMutation = useUploadAttachment(undefined, { silent: true });

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files) {
        let invalidTypeCount = 0;
        let tooLargeCount = 0;

        const validFiles = Array.from(files).filter((file) => {
          const isValidType = VALID_TYPES.includes(file.type);
          const isValidSize = file.size <= MAX_SIZE;
          if (!isValidType) invalidTypeCount += 1;
          if (!isValidSize) tooLargeCount += 1;
          return isValidType && isValidSize;
        });

        if (invalidTypeCount > 0) {
          toast.error("Invalid file type. Allowed: JPG, PNG, PDF.");
        }
        if (tooLargeCount > 0) {
          toast.error("File too large. Max size is 5MB.");
        }

        if (validFiles.length > 0) {
          setAttachments((prev) => [...prev, ...validFiles]);
        }
      }

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    []
  );

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clearAttachments = useCallback(() => {
    setAttachments([]);
  }, []);

  const uploadAll = useCallback(
    async (transactionId: string) => {
      if (attachments.length === 0) return;

      setIsUploading(true);
      try {
        const uploadResults = await Promise.allSettled(
          attachments.map((file) =>
            uploadMutation.mutateAsync({ file, transactionId })
          )
        );

        const failedUploads = uploadResults.filter(
          (result) => result.status === "rejected"
        );

        if (failedUploads.length > 0) {
          toast.error(
            `Failed to upload ${failedUploads.length} attachment${
              failedUploads.length === 1 ? "" : "s"
            }. Open the transaction to retry.`
          );
        } else {
          toast.success("Attachments uploaded.");
        }
      } finally {
        setIsUploading(false);
      }
    },
    [attachments, uploadMutation]
  );

  return {
    attachments,
    isUploading,
    fileInputRef,
    handleFileSelect,
    removeAttachment,
    uploadAll,
    clearAttachments,
  };
}
