import { Download } from "lucide-react";
import { TEMPLATE_INSTRUCTIONS } from "@shared/import-template";
import { IMPORT_TEMPLATE_URLS } from "../importApi";

const [INSTRUCTIONS_TITLE, ...INSTRUCTION_LINES] = TEMPLATE_INSTRUCTIONS;

/**
 * IMP-01: links to the CSV and Excel import templates, and the template's
 * instructions. The .xlsx carries them on its Instructions sheet; a CSV has
 * no room for them without rows the importer would read, so the wizard shows
 * the same lines here for both.
 */
export function TemplateDownloads() {
  return (
    <div className="mt-6 text-sm text-muted-foreground" data-testid="import-template-downloads">
      <p className="mb-2">Not sure how to lay out your file? Start from a template:</p>
      <div className="flex items-center justify-center gap-4">
        <a className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
          href={IMPORT_TEMPLATE_URLS.csv} download>
          <Download className="h-4 w-4" aria-hidden="true" />
          CSV template
        </a>
        <a className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
          href={IMPORT_TEMPLATE_URLS.xlsx} download>
          <Download className="h-4 w-4" aria-hidden="true" />
          Excel template (.xlsx)
        </a>
      </div>
      <details className="mx-auto mt-4 max-w-xl text-left" data-testid="import-template-instructions">
        <summary className="cursor-pointer font-medium text-foreground">{INSTRUCTIONS_TITLE}</summary>
        <div className="mt-2 space-y-1">
          {INSTRUCTION_LINES.map((line) => (
            <p key={line} className={line.startsWith(" ") ? "pl-4" : undefined}>{line.trim()}</p>
          ))}
        </div>
      </details>
    </div>
  );
}
