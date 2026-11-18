import { stringify } from "csv-stringify/sync";

type ExportFormat = "csv" | "json";

export class ExportService {
  /**
   * Convert array of objects to CSV
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
