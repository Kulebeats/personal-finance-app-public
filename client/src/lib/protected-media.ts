import { toastActionError } from "@/lib/actionErrorToast";
import { useEffect, useState } from "react";
import { protectedFetch } from "./protected-fetch";
import { throwIfResNotOk } from "./queryClient";
import { assertOperationLifetime, captureOperationLifetime, StaleOperationError, type OperationLifetime } from "./operation-lifetime";

export function reportProtectedMediaError(error: unknown): void {
  if (error instanceof StaleOperationError) return;
  toastActionError("Unable to load this file", error);
}

function downloadFilename(response: Response): string {
  const disposition = response.headers.get("Content-Disposition") || "";
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) { try { return decodeURIComponent(encoded); } catch { /* Use the plain filename below. */ } }
  return disposition.match(/filename="([^"]+)"/i)?.[1] || disposition.match(/filename=([^;]+)/i)?.[1]?.trim() || "download";
}

export async function downloadProtectedResource(url: string, filename?: string, operation = captureOperationLifetime()): Promise<void> {
  const response = await protectedFetch(url, {}, operation);
  await throwIfResNotOk(response);
  const blob = await response.blob();
  assertOperationLifetime(operation);
  downloadProtectedBlob(blob, filename || downloadFilename(response), operation);
}

export function downloadProtectedBlob(blob: Blob, filename: string, operation = captureOperationLifetime()): void {
  assertOperationLifetime(operation);
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    try { assertOperationLifetime(operation); anchor.click(); } finally { anchor.remove(); }
  } finally { URL.revokeObjectURL(objectUrl); }
}

export async function withProtectedBlob(url: string, consume: (objectUrl: string) => Promise<unknown>, operation = captureOperationLifetime()): Promise<void> {
  const response = await protectedFetch(url, {}, operation);
  await throwIfResNotOk(response);
  const blob = await response.blob();
  assertOperationLifetime(operation);
  const objectUrl = URL.createObjectURL(blob);
  try { await consume(objectUrl); } finally { URL.revokeObjectURL(objectUrl); }
}

interface MediaState { source: string | null; url: string | null; error: Error | null }
export function isProtectedMediaSource(source: string): boolean {
  try {
    const url = new URL(source, window.location.href);
    return url.origin === window.location.origin && (url.pathname.startsWith("/api/") || url.pathname.startsWith("/uploads/"));
  } catch { return false; }
}

export function useProtectedObjectUrl(source: string | null): Omit<MediaState, "source"> {
  const [state, setState] = useState<MediaState>({ source: null, url: null, error: null });
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    const controller = new AbortController();
    const operation: OperationLifetime | null = captureOperationLifetime();
    setState({ source, url: null, error: null });
    if (source) {
      void (async () => {
        try {
          const response = await protectedFetch(source, { signal: controller.signal }, operation);
          await throwIfResNotOk(response);
          const blob = await response.blob();
          assertOperationLifetime(operation);
          if (!active) return;
          objectUrl = URL.createObjectURL(blob);
          setState({ source, url: objectUrl, error: null });
        } catch (error) {
          if (!active || controller.signal.aborted || error instanceof StaleOperationError) return;
          setState({ source, url: null, error: error instanceof Error ? error : new Error("Unable to load file") });
        }
      })();
    }
    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source]);
  return state.source === source ? state : { url: null, error: null };
}
