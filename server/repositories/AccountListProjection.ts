import { sql } from "drizzle-orm";
import { accounts, type Account } from "@shared/schema";

const fields = ["id", "householdId", "name", "type", "subtype", "institution", "institutionLogo", "balance", "availableBalance",
  "initialBalance", "creditLimit", "estimatedValue", "purchaseDate", "address", "currency", "isAsset", "isPrivate", "ownerUserId",
  "isHidden", "isArchived", "excludeFromNetWorth", "hideTransactions", "color", "icon", "displayOrder", "notes",
  "createdAt", "updatedAt", "deletedAt"] as const;
export type AccountListItem = Pick<Account, typeof fields[number]>;
type DateField = "createdAt" | "updatedAt" | "deletedAt";
export type AccountListJson = Omit<AccountListItem, DateField> & { createdAt: string; updatedAt: string; deletedAt: string | null };

/** Existing client Account DTO fields only. This opt-in list projection must not
 * expand when new storage columns (for example account numbers) are introduced. */
export function accountListProjection(account: AccountListItem): AccountListItem {
  return Object.fromEntries(fields.map(field => [field, account[field]])) as AccountListItem;
}

/** Reuse the explicit DTO allowlist at the fresh publication statement. Numeric
 * SQL columns remain decimal strings and timestamp-without-zone fields are UTC. */
export function accountListJsonSql(alias: string) {
  const decimalFields = new Set(["balance", "availableBalance", "initialBalance", "creditLimit", "estimatedValue"]);
  const values = fields.flatMap(field => {
    const column = sql`${sql.identifier(alias)}.${sql.identifier(accounts[field].name)}`;
    const value = field === "createdAt" || field === "updatedAt" || field === "deletedAt"
      ? sql`to_char(${column},'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
      : field === "purchaseDate" ? sql`to_char(${column},'YYYY-MM-DD')`
      : decimalFields.has(field) ? sql`${column}::text` : column;
    return [sql`${field}::text`, value];
  });
  return sql`jsonb_build_object(${sql.join(values, sql`,`)})`;
}

export function accountListFromJson(account: AccountListJson): AccountListItem {
  return { ...account, createdAt: new Date(account.createdAt), updatedAt: new Date(account.updatedAt),
    deletedAt: account.deletedAt === null ? null : new Date(account.deletedAt) };
}
