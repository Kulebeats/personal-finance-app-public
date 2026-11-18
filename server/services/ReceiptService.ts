/**
 * Receipt Service
 *
 * Re-exports from modularized receipt services for backward compatibility.
 *
 * @module services/ReceiptService
 * @see services/receipt/index.ts for implementation
 */

export {
  ReceiptService,
  receiptService,
  type ProcessedReceipt,
} from "./receipt";

export { type ReceiptUpload } from "./receipt/image";
