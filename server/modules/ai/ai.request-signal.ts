/**
 * R17 review fix P2-2: an AbortSignal that fires when the client goes away.
 *
 * Express emits 'close' on the response both after a normal finish and when
 * the connection drops early; only the second is a cancellation, so the signal
 * aborts only when the response had not been fully written.
 *
 * @module ai/ai.request-signal
 */
import type { EventEmitter } from "node:events";

export type ClosableResponse = Pick<EventEmitter, "once"> & { readonly writableEnded: boolean };

export function abortSignalForResponse(res: ClosableResponse): AbortSignal {
  const controller = new AbortController();
  res.once("close", () => {
    if (!res.writableEnded) controller.abort(new Error("client disconnected"));
  });
  return controller.signal;
}
