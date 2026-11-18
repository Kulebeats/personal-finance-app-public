import React, { createContext, useContext, useState, ReactNode } from "react";

export type ImportStep =
  | "upload"
  | "column-mapping"
  | "category-mapping"
  | "review"
  | "progress"
  | "success";

export interface ImportMapping {
  date: string;
  amount: string;
  merchant?: string;
  category?: string;
  account?: string;
  notes?: string;
  tags?: string;
}

export interface ParsedData {
  headers: string[];
  rows: Record<string, string>[];
}

interface ImportWizardContextType {
  // State
  isOpen: boolean;
  currentStep: ImportStep;
  file: File | null;
  parsedData: ParsedData | null;
  mapping: ImportMapping;
  categoryMapping: Record<string, string>; // csvCategory -> dbCategoryId
  importStrategy: "prioritize_coppercoin" | "prioritize_csv";
  targetAccountId: string | null;

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
  reset: () => void;
}

const ImportWizardContext = createContext<ImportWizardContextType | undefined>(
  undefined
);

export function ImportWizardProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState<ImportStep>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedData | null>(null);

  const [mapping, setMapping] = useState<ImportMapping>({
    date: "",
    amount: "",
  });

  const [categoryMapping, setCategoryMapping] = useState<
    Record<string, string>
  >({});
  const [importStrategy, setStrategy] = useState<
    "prioritize_coppercoin" | "prioritize_csv"
  >("prioritize_coppercoin");
  const [targetAccountId, setTargetAccountId] = useState<string | null>(null);

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
    setParsedData(null);
    setMapping({ date: "", amount: "" });
    setCategoryMapping({});
    setStrategy("prioritize_coppercoin");
    setTargetAccountId(null);
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
        categoryMapping,
        importStrategy,
        targetAccountId,
        openWizard,
        closeWizard,
        setStep: setCurrentStep,
        setFile,
        setParsedData,
        updateMapping,
        updateCategoryMapping,
        setStrategy,
        setTargetAccountId,
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
