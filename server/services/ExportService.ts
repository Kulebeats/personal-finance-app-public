import { stringify } from "csv-stringify/sync";
import { CsvDecimal, neutralizeCsvFormula } from "../core/csv";

export class ExportService {
  /**
   * Convert array of objects to CSV. Text cells a spreadsheet would run as a
   * formula are neutralized; numbers and CsvDecimal cells stay numeric.
   */
  generateCsv(data: Record<string, unknown>[], columns?: string[]): string {
    if (!data || data.length === 0) {
      return "";
    }

    return stringify(data, {
      header: true,
      columns: columns,
      cast: {
        date: (date) => date.toISOString().split("T")[0],
        string: (value) => neutralizeCsvFormula(value),
        object: (value) => (value instanceof CsvDecimal ? value.text : JSON.stringify(value)),
      },
    });
  }

  /**
   * Flatten complex objects for export if needed
   */
  flattenData(data: Record<string, unknown>[]): Record<string, unknown>[] {
    // Basic flattening could go here if needed
    return data;
  }
}

export const exportService = new ExportService();
