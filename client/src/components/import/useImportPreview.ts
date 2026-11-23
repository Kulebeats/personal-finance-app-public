import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useImportWizard } from "./ImportWizardContext";
import { previewImport, referenceDisplaysFor, type ImportPreviewResult } from "./importApi";

/**
 * NEW-17: the server preview for the current wizard choices (chosen date
 * format, identities, duplicate candidates). Rows only change with a new file,
 * which also mints a new batch id, so the batch id stands in for them in the key.
 * When a preview arrives, every candidate defaults to "skip"; the user can untick.
 */
export function useImportPreview() {
  const { parsedData, mapping, dateFormat, categoryMapping, importStrategy, targetAccountId, batchId,
    setSkipRowOrdinals, setReviewedRemovals, setPreviewCandidates, setPreviewCurrency } = useImportWizard();
  const query = useQuery<ImportPreviewResult>({
    queryKey: ["import-preview", batchId, targetAccountId, importStrategy, dateFormat, mapping, categoryMapping],
    queryFn: () => previewImport({
      targetAccountId, strategy: importStrategy, mapping: { ...mapping }, dateFormat,
      categoryMapping: { ...categoryMapping }, rows: parsedData?.rows, cellIssues: parsedData?.cellIssues ?? [],
      referenceDisplays: referenceDisplaysFor(parsedData, mapping),
    }),
    enabled: !!targetAccountId && !!parsedData?.rows.length,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });

  useEffect(() => {
    if (!query.data) return;
    setSkipRowOrdinals(query.data.rows.filter(row => row.status === "candidate").map(row => row.ordinal));
    // A-02: execute is bound to exactly the removals this preview listed.
    setReviewedRemovals((query.data.removals ?? []).map(({ id, version }) => ({ id, version })));
    // A-01: an unticked candidate is imported against exactly the ledger row shown here.
    setPreviewCandidates(query.data.rows.flatMap(row => row.status === "candidate" && row.candidate
      ? [{ ordinal: row.ordinal, candidateId: row.candidate.id }] : []));
    // R2 P2: execute is bound to the currency these amounts were reviewed in.
    setPreviewCurrency(query.data.accountCurrency);
  }, [query.data, setSkipRowOrdinals, setReviewedRemovals, setPreviewCandidates, setPreviewCurrency]);

  return query;
}
