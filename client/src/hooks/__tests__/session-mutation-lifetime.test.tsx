import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider, useMutation } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { apiCall } from "@/lib/api";
import { createDataQueryClient } from "@/lib/queryClient";
import { activateOperationLifetime, createOperationLifetime, retireOperationLifetime } from "@/lib/operation-lifetime";

afterEach(() => { cleanup(); retireOperationLifetime(); vi.unstubAllGlobals(); });
it("keeps a pending hook mutation fenced across observer option updates", async () => {
  const operation = createOperationLifetime(); activateOperationLifetime(operation);
  const client = createDataQueryClient(undefined, operation);
  let release!: () => void;
  const preparation = new Promise<void>(resolve => { release = resolve; });
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ success: true })));
  vi.stubGlobal("fetch", fetcher);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result, rerender } = renderHook(() => useMutation({ onMutate: async () => preparation, mutationFn: () => apiCall("/accounts") }), { wrapper });
  let pending!: Promise<unknown>;
  act(() => { pending = result.current.mutateAsync(); });
  const rejected = expect(pending).rejects.toThrow(/session changed/i);
  await waitFor(() => expect(result.current.isPending).toBe(true));
  rerender();
  retireOperationLifetime(); activateOperationLifetime(createOperationLifetime());
  await act(async () => { release(); await rejected; });
  expect(fetcher).not.toHaveBeenCalled();
  client.clear();
});
