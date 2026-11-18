/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type React from "react";
import { useTransactionAttachments } from "../useTransactionAttachments";
import { useUploadAttachment } from "../useAttachments";
import { toast } from "sonner";

const uploadMutationState = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
}));

vi.mock("../useAttachments", () => ({
  useUploadAttachment: vi.fn(() => uploadMutationState),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const mockUseUploadAttachment = vi.mocked(useUploadAttachment);
const mockToast = vi.mocked(toast);

function makeChangeEvent(files: File[]): React.ChangeEvent<HTMLInputElement> {
  return { target: { files } } as unknown as React.ChangeEvent<HTMLInputElement>;
}

describe("useTransactionAttachments", () => {
  beforeEach(() => {
    uploadMutationState.mutateAsync = vi.fn();
    mockUseUploadAttachment.mockReturnValue(uploadMutationState as unknown as ReturnType<typeof useUploadAttachment>);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("adds valid files and clears the input", () => {
    const { result } = renderHook(() => useTransactionAttachments());
    const input = document.createElement("input");
    input.value = "has-value";

    act(() => {
      (result.current.fileInputRef as unknown as { current: HTMLInputElement | null }).current = input;
      result.current.handleFileSelect(
        makeChangeEvent([
          new File(["content"], "receipt.png", { type: "image/png" }),
        ])
      );
    });

    expect(result.current.attachments).toHaveLength(1);
    expect(result.current.attachments[0].name).toBe("receipt.png");
    expect(input.value).toBe("");
  });

  it("rejects invalid type and oversized files", () => {
    const { result } = renderHook(() => useTransactionAttachments());
    const oversizedContent = new Uint8Array(5 * 1024 * 1024 + 1);

    act(() => {
      result.current.handleFileSelect(
        makeChangeEvent([
          new File(["bad"], "notes.txt", { type: "text/plain" }),
          new File([oversizedContent], "big.pdf", {
            type: "application/pdf",
          }),
        ])
      );
    });

    expect(result.current.attachments).toHaveLength(0);
    expect(mockToast.error).toHaveBeenCalledWith(
      "Invalid file type. Allowed: JPG, PNG, PDF."
    );
    expect(mockToast.error).toHaveBeenCalledWith(
      "File too large. Max size is 5MB."
    );
  });

  it("uploads all attachments and reports success", async () => {
    const fileA = new File(["a"], "a.png", { type: "image/png" });
    const fileB = new File(["b"], "b.pdf", { type: "application/pdf" });

    const { result } = renderHook(() => useTransactionAttachments());

    act(() => {
      result.current.handleFileSelect(makeChangeEvent([fileA, fileB]));
    });

    await act(async () => {
      await result.current.uploadAll("tx-123");
    });

    expect(uploadMutationState.mutateAsync).toHaveBeenCalledTimes(2);
    expect(uploadMutationState.mutateAsync).toHaveBeenCalledWith({
      file: fileA,
      transactionId: "tx-123",
    });
    expect(uploadMutationState.mutateAsync).toHaveBeenCalledWith({
      file: fileB,
      transactionId: "tx-123",
    });
    expect(mockToast.success).toHaveBeenCalledWith("Attachments uploaded.");
    expect(mockToast.error).not.toHaveBeenCalled();
    expect(result.current.isUploading).toBe(false);
  });

  it("reports partial failures when uploads reject", async () => {
    const fileA = new File(["a"], "ok.png", { type: "image/png" });
    const fileB = new File(["b"], "fail.pdf", { type: "application/pdf" });

    uploadMutationState.mutateAsync = vi.fn(({ file }: { file: File }) => {
      if (file.name === "fail.pdf") {
        return Promise.reject(new Error("Upload failed"));
      }
      return Promise.resolve({});
    });

    const { result } = renderHook(() => useTransactionAttachments());

    act(() => {
      result.current.handleFileSelect(makeChangeEvent([fileA, fileB]));
    });

    await act(async () => {
      await result.current.uploadAll("tx-456");
    });

    expect(uploadMutationState.mutateAsync).toHaveBeenCalledTimes(2);
    expect(mockToast.error).toHaveBeenCalledWith(
      "Failed to upload 1 attachment. Open the transaction to retry."
    );
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(result.current.isUploading).toBe(false);
  });

  it("does nothing when uploading with no attachments", async () => {
    const { result } = renderHook(() => useTransactionAttachments());

    await act(async () => {
      await result.current.uploadAll("tx-empty");
    });

    expect(uploadMutationState.mutateAsync).not.toHaveBeenCalled();
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(mockToast.error).not.toHaveBeenCalled();
  });
});
