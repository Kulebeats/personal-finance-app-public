/**
 * ChartDataTable Component
 *
 * Renders chart data as an accessible HTML table.
 * Used as an alternative view for screen reader users.
 */

import { cn } from "@/lib/utils";

export interface ChartDataColumn {
  key: string;
  label: string;
  /** Optional formatter for cell values */
  format?: (value: unknown) => string;
  /** Alignment for the column */
  align?: "left" | "center" | "right";
}

export interface ChartDataTableProps {
  id: string;
  caption: string;
  columns: ChartDataColumn[];
  data: Record<string, unknown>[];
  className?: string;
}

export function ChartDataTable({
  id,
  caption,
  columns,
  data,
  className,
}: ChartDataTableProps) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table id={id} className="w-full text-sm border-collapse" role="table">
        <caption className="text-left text-base font-medium mb-2 p-2 bg-muted/30 rounded-t">
          {caption}
        </caption>
        <thead>
          <tr className="border-b border-border">
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={cn(
                  "p-3 font-semibold text-foreground bg-muted/20",
                  col.align === "center" && "text-center",
                  col.align === "right" && "text-right",
                  (!col.align || col.align === "left") && "text-left",
                )}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, rowIndex) => (
            <tr
              key={rowIndex}
              className={cn(
                "border-b border-border/50 hover:bg-muted/10",
                rowIndex % 2 === 0 && "bg-muted/5",
              )}
            >
              {columns.map((col, colIndex) => {
                const value = row[col.key];
                const displayValue = col.format
                  ? col.format(value)
                  : String(value ?? "");

                // First column is typically the row header
                if (colIndex === 0) {
                  return (
                    <th
                      key={col.key}
                      scope="row"
                      className={cn(
                        "p-3 font-medium text-foreground",
                        col.align === "center" && "text-center",
                        col.align === "right" && "text-right",
                        (!col.align || col.align === "left") && "text-left",
                      )}
                    >
                      {displayValue}
                    </th>
                  );
                }

                return (
                  <td
                    key={col.key}
                    className={cn(
                      "p-3 text-muted-foreground",
                      col.align === "center" && "text-center",
                      col.align === "right" && "text-right",
                      (!col.align || col.align === "left") && "text-left",
                    )}
                  >
                    {displayValue}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Utility to convert typical chart datasets to table format
 */
export function mapChartDataToTable<T extends Record<string, unknown>>(
  data: T[],
  labelKey: string,
  valueKeys: string[],
  formatters?: Record<string, (value: unknown) => string>,
): { columns: ChartDataColumn[]; rows: Record<string, unknown>[] } {
  const columns: ChartDataColumn[] = [
    { key: labelKey, label: "Category", align: "left" },
    ...valueKeys.map((key) => ({
      key,
      label:
        key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, " $1"),
      format: formatters?.[key],
      align: "right" as const,
    })),
  ];

  return { columns, rows: data };
}
