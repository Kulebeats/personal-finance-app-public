/**
 * IMP-01: a file that still carries every template header is mapped
 * automatically, so a filled-in template needs no manual column assignment.
 */
import { TEMPLATE_COLUMNS, type TemplateMappingField } from "@shared/import-template";

export function templateMappingFor(headers: readonly string[]): Array<[TemplateMappingField, string]> | null {
  const present = new Set(headers);
  if (!TEMPLATE_COLUMNS.every(column => present.has(column.header))) return null;
  return TEMPLATE_COLUMNS.map(column => [column.field, column.header]);
}
