import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Copy, Download } from "lucide-react";

interface MfaBackupCodesPanelProps {
  codes: string[];
  onDone: () => void;
}

const DOWNLOAD_FILENAME = "capital-backup-codes.txt";

function codesAsText(codes: string[]): string {
  return [
    "Capital two-step verification backup codes",
    "Each code works once. Keep them somewhere safe.",
    "",
    ...codes,
    "",
  ].join("\n");
}

/**
 * Shows backup codes once. The person must confirm they saved them before
 * the panel can be closed — the server never shows these codes again.
 */
export function MfaBackupCodesPanel({ codes, onDone }: MfaBackupCodesPanelProps) {
  const [hasSaved, setHasSaved] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setNotice("Codes copied to your clipboard.");
    } catch {
      setNotice("Couldn't copy. Select the codes and copy them, or download them instead.");
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([codesAsText(codes)], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = DOWNLOAD_FILENAME;
    link.click();
    URL.revokeObjectURL(url);
    setNotice("Codes downloaded.");
  };

  return (
    <div className="space-y-4">
      <p className="text-sm">
        Save these backup codes now. Each one lets you sign in once if you can't get an email code.
        You won't see them again.
      </p>
      <ul aria-label="Backup codes" className="grid grid-cols-2 gap-2 rounded-lg bg-muted/50 p-3 font-mono text-sm">
        {codes.map((code) => (
          <li key={code} className="select-all">{code}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={copy}>
          <Copy className="mr-2 h-4 w-4" aria-hidden="true" />
          Copy codes
        </Button>
        <Button type="button" variant="outline" onClick={download}>
          <Download className="mr-2 h-4 w-4" aria-hidden="true" />
          Download codes
        </Button>
      </div>
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">{notice}</p>
      <div className="flex items-center gap-2">
        <Checkbox id="mfa-codes-saved" checked={hasSaved} onCheckedChange={(checked) => setHasSaved(checked === true)} />
        <Label htmlFor="mfa-codes-saved">I've saved these codes somewhere safe</Label>
      </div>
      <div className="flex justify-end">
        <Button type="button" onClick={onDone} disabled={!hasSaved}>Done</Button>
      </div>
    </div>
  );
}
