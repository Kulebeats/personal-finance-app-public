import React, { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { useImportWizard } from "../ImportWizardContext";
import { Button } from "@/components/ui/button";
import {
  UploadCloud,
  FileSpreadsheet,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { parseImportCsv } from "../importApi";

export function UploadStep() {
  const { setFile, setParsedData, setStep } = useImportWizard();
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (!file) return;

      setIsUploading(true);
      setError(null);

      try {
        // Goes through apiCall so the upload carries x-csrf-token.
        const data = await parseImportCsv(file);

        setFile(file);
        setParsedData(data); // { headers: [], rows: [] }
        setStep("column-mapping");
      } catch (err) {
        console.error(err);
        setError((err as Error).message);
      } finally {
        setIsUploading(false);
      }
    },
    [setFile, setParsedData, setStep]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "text/csv": [".csv"],
      "application/vnd.ms-excel": [".csv"],
    },
    maxFiles: 1,
  });

  return (
    <div className="flex flex-col items-center justify-center p-12 text-center h-[500px]">
      <div className="mb-8">
        <h2 className="text-2xl font-bold mb-2">
          Upload your transactions CSV
        </h2>
        <p className="text-muted-foreground max-w-md mx-auto">
          Export transaction history from your bank or another app and upload it
          here. We'll help you map the columns next.
        </p>
      </div>

      <div
        {...getRootProps()}
        className={`w-full max-w-xl p-12 border-2 border-dashed rounded-lg transition-colors cursor-pointer flex flex-col items-center gap-4
          ${
            isDragActive
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/50"
          }
          ${error ? "border-destructive/50 bg-destructive/5" : ""}
        `}
      >
        <input {...getInputProps()} />

        {isUploading ? (
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-12 w-12 text-primary animate-spin" />
            <p className="text-sm font-medium">Parsing file...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-2">
            <AlertCircle className="h-12 w-12 text-destructive" />
            <p className="text-destructive font-medium">{error}</p>
            <p className="text-sm text-muted-foreground">
              Click or drag to try again
            </p>
          </div>
        ) : (
          <>
            <div className="h-16 w-16 bg-muted rounded-full flex items-center justify-center mb-2">
              <FileSpreadsheet className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <p className="font-medium">
                {isDragActive
                  ? "Drop the CSV here"
                  : "Upload your transactions CSV"}
              </p>
              <p className="text-xs text-muted-foreground">
                Supported formats: CSV
              </p>
            </div>
          </>
        )}
      </div>

      {/* Manual Trigger Button just in case */}
      {!isUploading && (
        <div className="mt-8">
          <Button
            variant="default"
            className="w-[200px]"
            onClick={(e) => e.preventDefault()}
          >
            Select File
          </Button>
          {/* Note: The dropzone covers this usually, but visual affordance helps */}
        </div>
      )}
    </div>
  );
}
