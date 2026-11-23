import React, { createContext, useContext, useState, ReactNode } from "react";
import type { ImportDateFormat } from "@shared/import-date";
import type { CandidatePostDecision, ReviewedRemoval } from "./importApi";

export type ImportStep =
  | "upload"
  | "column-mapping"
  | "category-mapping"
  | "review"
  | "progress"
  | "success";

export interface ImportMapping {
  date: string;
  /** Signed amount; or map debit and/or credit instead (IMP-01). */
  amount: string;
  debit?: string;
  credit?: string;
  currency?: string;
  merchant?: string;
  category?: string;
  account?: string;
  notes?: string;
  tags?: string;
  /** Bank/provider transaction reference: the row identity when mapped (NEW-17). */
  reference?: string;
}

/** Mirrors server/services/import/spreadsheet.ts ParsedImportFile. */
export interface ParsedData {
  headers: string[];
  rows: Record<string, string>[];
  format?: "csv" | "xlsx";
  /** Excel only: every sheet name and the sheet that was read. */
  sheets?: string[];
  /** Excel only: sheets hidden in Excel. */
  hiddenSheets?: string[];
  sheet?: string;
  /** Excel only: formula cells read by the value Excel last saved. */
  formulaCells?: number;
  /** Excel only: cells that cannot be imported as Excel shows them; sent back with the rows. */
  cellIssues?: ImportCellIssue[];
  /** Excel only: number cells shown with leading zeros; the Reference reads these, every other field the stored value. */
  referenceDisplays?: ImportReferenceDisplay[];
}

/** Mirrors server/services/import/types.ts ImportReferenceDisplay. */
export interface ImportReferenceDisplay {
  row: number;
  column: string;
  text: string;
}

/** Mirrors server/services/import/types.ts ImportCellIssue. */
export interface ImportCellIssue {
  row: number;
  column: string;
  issue: string;
  field?: "reference";
}

interface ImportWizardContextType {
  // State
  isOpen: boolean;
  currentStep: ImportStep;
  file: File | null;
  parsedData: ParsedData | null;
  mapping: ImportMapping;
  dateFormat: ImportDateFormat;
  setDateFormat: (format: ImportDateFormat) => void;
  categoryMapping: Record<string, string>; // csvCategory -> dbCategoryId
  importStrategy: "prioritize_coppercoin" | "prioritize_csv";
  targetAccountId: string | null;
  /** One id per wizard run, so a lost response is retried as a replay, never a second import. */
  batchId: string;
  /** Ordinals of duplicate candidates the user confirmed as already in the ledger. */
  skipRowOrdinals: number[];
  /** A-02: the ledger rows the preview showed a "CSV wins" import removing; execute removes no others. */
  reviewedRemovals: ReviewedRemoval[];
  /** A-01: each duplicate candidate the preview showed, with the ledger row it matched. */
  previewCandidates: CandidatePostDecision[];
  /** R2 P2: the account currency the latest preview showed. */
  previewCurrency: string | undefined;

  // Actions
  openWizard: (accountId?: string) => void;
  closeWizard: () => void;
  setStep: (step: ImportStep) => void;
  setFile: (file: File) => void;
  setParsedData: (data: ParsedData) => void;
  updateMapping: (field: keyof ImportMapping, csvHeader: string) => void;
  updateCategoryMapping: (csvCategory: string, dbCategoryId: string) => void;
  setStrategy: (strategy: "prioritize_coppercoin" | "prioritize_csv") => void;
  setTargetAccountId: (id: string) => void;
  setSkipRowOrdinals: (ordinals: number[]) => void;
  setReviewedRemovals: (removals: ReviewedRemoval[]) => void;
  setPreviewCandidates: (candidates: CandidatePostDecision[]) => void;
  setPreviewCurrency: (currency: string | undefined) => void;
  reset: () => void;
}

const ImportWizardContext = createContext<ImportWizardContextType | undefined>(
  undefined
);

export function ImportWizardProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState<ImportStep>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedDataState] = useState<ParsedData | null>(null);

  const [mapping, setMapping] = useState<ImportMapping>({
    date: "",
    amount: "",
  });
  const [dateFormat, setDateFormat] = useState<ImportDateFormat>("auto");

  const [categoryMapping, setCategoryMapping] = useState<
    Record<string, string>
  >({});
  const [importStrategy, setStrategy] = useState<
    "prioritize_coppercoin" | "prioritize_csv"
  >("prioritize_coppercoin");
  const [targetAccountId, setTargetAccountId] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string>(() => crypto.randomUUID());
  const [skipRowOrdinals, setSkipRowOrdinals] = useState<number[]>([]);
  const [reviewedRemovals, setReviewedRemovals] = useState<ReviewedRemoval[]>([]);
  const [previewCandidates, setPreviewCandidates] = useState<CandidatePostDecision[]>([]);
  const [previewCurrency, setPreviewCurrency] = useState<string | undefined>(undefined);

  const openWizard = (accountId?: string) => {
    reset();
    if (accountId) setTargetAccountId(accountId);
    setIsOpen(true);
  };

  const closeWizard = () => {
    setIsOpen(false);
    // Optional: delay reset
  };

  const reset = () => {
    setCurrentStep("upload");
    setFile(null);
    setParsedDataState(null);
    setMapping({ date: "", amount: "" });
    setDateFormat("auto");
    setCategoryMapping({});
    setStrategy("prioritize_coppercoin");
    setTargetAccountId(null);
    setBatchId(crypto.randomUUID());
    setSkipRowOrdinals([]);
    setReviewedRemovals([]);
    setPreviewCandidates([]);
    setPreviewCurrency(undefined);
  };

  /**
   * A new file or sheet starts a new mapping and a new batch (IMP-01 review r5):
   * a column kept from the old file could name a header the new one lacks.
   */
  const setParsedData = (data: ParsedData) => {
    setParsedDataState(data);
    setMapping({ date: "", amount: "" });
    setCategoryMapping({});
    setSkipRowOrdinals([]);
    setReviewedRemovals([]);
    setPreviewCandidates([]);
    setPreviewCurrency(undefined);
    setBatchId(crypto.randomUUID());
  };

  const updateMapping = (field: keyof ImportMapping, csvHeader: string) => {
    setMapping((prev) => ({ ...prev, [field]: csvHeader }));
  };

  const updateCategoryMapping = (csvCategory: string, dbCategoryId: string) => {
    setCategoryMapping((prev) => ({ ...prev, [csvCategory]: dbCategoryId }));
  };

  return (
    <ImportWizardContext.Provider
      value={{
        isOpen,
        currentStep,
        file,
        parsedData,
        mapping,
        dateFormat,
        setDateFormat,
        categoryMapping,
        importStrategy,
        targetAccountId,
        batchId,
        skipRowOrdinals,
        reviewedRemovals,
        previewCandidates,
        previewCurrency,
        openWizard,
        closeWizard,
        setStep: setCurrentStep,
        setFile,
        setParsedData,
        updateMapping,
        updateCategoryMapping,
        setStrategy,
        setTargetAccountId,
        setSkipRowOrdinals,
        setReviewedRemovals,
        setPreviewCandidates,
        setPreviewCurrency,
        reset,
      }}
    >
      {children}
    </ImportWizardContext.Provider>
  );
}

export function useImportWizard() {
  const context = useContext(ImportWizardContext);
  if (context === undefined) {
    throw new Error(
      "useImportWizard must be used within an ImportWizardProvider"
    );
  }
  return context;
}
