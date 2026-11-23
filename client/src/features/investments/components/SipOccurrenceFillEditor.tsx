import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SipActualFillInput } from "@/hooks/investments/sipOccurrenceApi";

export function SipOccurrenceFillEditor({ index, fill, currency, disabled, fields, onChange, onRemove }: {
  index: number;
  fill: SipActualFillInput;
  currency: string;
  disabled: boolean;
  fields: Record<string, string[]>;
  onChange: (fill: SipActualFillInput) => void;
  onRemove: () => void;
}) {
  const id = useId();
  const controls = [
    { field: "executionDate", label: "execution date", type: "date", pattern: undefined },
    { field: "quantity", label: "quantity", type: "text", pattern: "[0-9]+(?:\\.[0-9]{1,8})?" },
    { field: "price", label: `price (${currency})`, type: "text", pattern: "[0-9]+(?:\\.[0-9]{1,4})?" },
    { field: "fees", label: `fees (${currency})`, type: "text", pattern: "[0-9]+(?:\\.[0-9]{1,2})?" },
  ] as const;
  return (
    <fieldset disabled={disabled} className="space-y-3 rounded-md border p-3">
      <legend className="px-1 text-sm font-semibold">Actual fill {index + 1}</legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {controls.map(control => {
          const error = fields[`fills.${index}.${control.field}`]?.[0];
          const inputId = `${id}-${control.field}`;
          return <div key={control.field} className="space-y-1">
            <Label htmlFor={inputId}>Fill {index + 1} {control.label}</Label>
            <Input id={inputId} type={control.type} inputMode={control.type === "text" ? "decimal" : undefined}
              required pattern={control.pattern} value={fill[control.field]} aria-invalid={!!error}
              aria-describedby={error ? `${inputId}-error` : undefined}
              onChange={event => onChange({ ...fill, [control.field]: event.target.value })} />
            {error && <p id={`${inputId}-error`} className="text-sm text-destructive">{error}</p>}
          </div>;
        })}
      </div>
      <p className="text-xs text-muted-foreground">Enter this fill's own fees, including an explicit 0 when the statement shows no fees.</p>
      <Button type="button" variant="outline" size="sm" onClick={onRemove}>Remove fill {index + 1}</Button>
    </fieldset>
  );
}
