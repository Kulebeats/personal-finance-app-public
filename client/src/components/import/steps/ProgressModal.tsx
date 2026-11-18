import { useEffect, useState } from "react";
import { useImportWizard } from "../ImportWizardContext";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { executeImport } from "../importApi";

type ProgressStage =
  | "uploading"
  | "mapping"
  | "importing"
  | "complete"
  | "error";

export function ProgressModal() {
  const {
    parsedData,
    mapping,
    categoryMapping,
    importStrategy,
    targetAccountId,
    closeWizard,
    setStep,
  } = useImportWizard();

  const [stage, setStage] = useState<ProgressStage>("uploading");
  const [result, setResult] = useState<{
    imported: number;
    skipped: number;
    deleted: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    const execute = async () => {
      try {
        // Fake stages for visual feedback
        setStage("uploading");
        await new Promise((r) => setTimeout(r, 600));

        setStage("mapping");
        await new Promise((r) => setTimeout(r, 600));

        setStage("importing");

        // Real API call — through apiCall so it carries x-csrf-token.
        const data = await executeImport({
          targetAccountId,
          strategy: importStrategy,
          mapping,
          categoryMapping,
          rows: parsedData?.rows,
        });
        setResult(data);
        setStage("complete");

        // Invalidate queries to refresh UI
        queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
        queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      } catch (err) {
        console.error(err);
        setError((err as Error).message);
        setStage("error");
      }
    };

    execute();
  }, []);

  const StepItem = ({
    status,
    label,
  }: {
    status: "pending" | "loading" | "done" | "error";
    label: string;
  }) => {
    let icon = <div className="h-6 w-6 rounded-full border-2 border-muted" />;
    if (status === "loading")
      icon = <Loader2 className="h-6 w-6 animate-spin text-primary" />;
    if (status === "done")
      icon = <CheckCircle2 className="h-6 w-6 text-green-500" />;
    if (status === "error")
      icon = <AlertCircle className="h-6 w-6 text-destructive" />;

    return (
      <div className="flex items-center gap-3 py-2">
        {icon}
        <span
          className={`text-lg ${
            status === "done" || status === "loading"
              ? "text-foreground font-medium"
              : "text-muted-foreground"
          }`}
        >
          {label}
        </span>
      </div>
    );
  };

  return (
    <div className="flex flex-col items-center justify-center h-full p-12">
      {stage === "complete" ? (
        <div className="text-center space-y-6">
          <div className="h-20 w-20 bg-green-100 dark:bg-green-900/20 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="h-10 w-10 text-green-600 dark:text-green-400" />
          </div>
          <h2 className="text-2xl font-bold">Import Successful!</h2>
          <div className="bg-muted p-4 rounded-lg text-left text-sm space-y-2 min-w-[300px]">
            <div className="flex justify-between">
              <span>Imported:</span>
              <span className="font-bold">{result?.imported}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Skipped (Duplicates):</span>
              <span>{result?.skipped}</span>
            </div>
            {result?.deleted ? (
              <div className="flex justify-between text-destructive">
                <span>Deleted (Overwritten):</span>
                <span>{result?.deleted}</span>
              </div>
            ) : null}
          </div>
          <Button onClick={closeWizard} className="w-full">
            Done
          </Button>
        </div>
      ) : stage === "error" ? (
        <div className="text-center space-y-6">
          <div className="h-20 w-20 bg-destructive/10 rounded-full flex items-center justify-center mx-auto">
            <AlertCircle className="h-10 w-10 text-destructive" />
          </div>
          <h2 className="text-2xl font-bold">Import Failed</h2>
          <p className="text-destructive max-w-md">{error}</p>
          <Button onClick={() => setStep("review")} variant="outline">
            Try Again
          </Button>
        </div>
      ) : (
        <div className="w-full max-w-sm space-y-6">
          <h2 className="text-xl font-semibold text-center mb-8">
            Importing transactions...
          </h2>

          <div className="space-y-4">
            <StepItem
              status={stage === "uploading" ? "loading" : "done"}
              label="Uploading CSV files"
            />
            <StepItem
              status={
                stage === "uploading"
                  ? "pending"
                  : stage === "mapping"
                  ? "loading"
                  : "done"
              }
              label="Mapping the accounts"
            />
            <StepItem
              status={
                stage === "uploading" || stage === "mapping"
                  ? "pending"
                  : stage === "importing"
                  ? "loading"
                  : "done"
              }
              label="Importing 1 transactions"
            />
          </div>
        </div>
      )}
    </div>
  );
}
