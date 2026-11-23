/**
 * IMP-01 import template: one definition for the downloadable CSV/.xlsx
 * template (server), the importer's refusal of the example row (server) and
 * the wizard's automatic column mapping (client).
 */

/** Wizard mapping keys a template column fills. */
export type TemplateMappingField =
  | "date" | "merchant" | "amount" | "debit" | "credit" | "category"
  | "account" | "currency" | "notes" | "reference";

export interface TemplateColumn {
  header: string;
  field: TemplateMappingField;
  example: string;
}

/**
 * Any cell holding one of these exact values marks the template's example
 * row. The importer refuses that row, so a template submitted unchanged
 * imports nothing.
 */
export const TEMPLATE_EXAMPLE_MARKERS = ["EXAMPLE ROW - DELETE BEFORE IMPORTING", "TEMPLATE-EXAMPLE"] as const;

export const TEMPLATE_COLUMNS: readonly TemplateColumn[] = [
  { header: "Date", field: "date", example: "2026-01-31" },
  { header: "Description", field: "merchant", example: TEMPLATE_EXAMPLE_MARKERS[0] },
  { header: "Amount", field: "amount", example: "-12.50" },
  { header: "Debit", field: "debit", example: "" },
  { header: "Credit", field: "credit", example: "" },
  { header: "Category", field: "category", example: "Groceries" },
  { header: "Account", field: "account", example: "Everyday Checking" },
  { header: "Currency", field: "currency", example: "ZMW" },
  { header: "Notes", field: "notes", example: "Use Amount, or Debit and Credit, never both on one row" },
  { header: "Reference", field: "reference", example: TEMPLATE_EXAMPLE_MARKERS[1] },
];

export const TEMPLATE_INSTRUCTIONS: readonly string[] = [
  "How to fill in this template",
  "1. Delete the example row (it is refused if left in), then add one row per transaction.",
  "2. Date: an Excel date cell, or text as YYYY-MM-DD, DD/MM/YYYY or MM/DD/YYYY. Choose the order for slash dates in the import wizard.",
  "   Dates are calendar days: no time-zone conversion is applied. A plain number in the Date column is not read as a date; format the column as Date.",
  "3. Amount: negative for money out (expenses), positive for money in (income). Up to two decimal places; more is refused, never rounded.",
  "   Or leave Amount empty and use Debit (money out) and Credit (money in) as positive numbers. Never fill both on one row.",
  "4. Currency is an optional check: a row whose currency differs from the account you import into is refused. Account is for your own reference; every row goes into the account you choose in the wizard.",
  "5. Reference: your bank's transaction id, if you have one. Rows with the same reference are recognised as the same transaction on a later import.",
  "6. Formulas: only the value Excel last calculated is read; formulas are never evaluated. Macro-enabled files (.xlsm) and old .xls files are refused.",
  "7. Limits: the first sheet is imported unless you choose another; at most 5000 rows and 5 MB per Excel file.",
];
