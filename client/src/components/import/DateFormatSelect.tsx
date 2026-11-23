import type { ImportDateFormat } from "@shared/import-date";
import { IMPORT_DATE_FORMATS } from "@shared/import-date";
import { Label } from "@/components/ui/label";

export function DateFormatSelect({ value, onChange }: {
  value: ImportDateFormat; onChange: (value: ImportDateFormat) => void;
}) {
  return <div className="space-y-2">
    <Label htmlFor="csv-date-format">CSV date format</Label>
    <select id="csv-date-format" className="w-full rounded-md border bg-background p-2"
      value={value} onChange={event => onChange(event.target.value as ImportDateFormat)}>
      {IMPORT_DATE_FORMATS.map(format => <option key={format} value={format}>
        {format === "auto" ? "Auto (unambiguous dates only)" : format}
      </option>)}
    </select>
    <p className="text-xs text-muted-foreground">
      Choose the order for slash dates. ISO dates keep their calendar day.
      Calendar dates are imported without timezone conversion.
    </p>
  </div>;
}
