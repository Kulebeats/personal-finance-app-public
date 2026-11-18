/**
 * Receipts Module - Service
 *
 * Re-exports the main ReceiptService for use by the modular controller.
 *
 * @module modules/receipts/service
 */

export { receiptService } from "../../services/ReceiptService";
// Note: receiptParser exports individual functions (parseReceiptText, calculateConfidence)
// Import them directly from ../../services/receiptParser when needed
