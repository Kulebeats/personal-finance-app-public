import { sql, type SQL } from "drizzle-orm";
import { providerFxQuotes as quotes } from "@shared/schema";

/** Financial flow dates use the provider's dated observation and inclusive validity. */
export function providerFlowRate(currency: SQL, base: string, date: SQL, observedBy?: SQL) {
  return sql`CASE WHEN ${currency} = ${base}::text THEN 1 ELSE (
    SELECT ${quotes.rate} FROM ${quotes}
    WHERE ${quotes.fromCurrency} = ${currency} AND ${quotes.toCurrency} = ${base}::text
      AND ${quotes.effectiveDate} <= ${date} AND ${quotes.validThrough} >= ${date}
      ${observedBy ? sql`AND ${quotes.quotedAt} <= ${observedBy} AND ${quotes.recordedAt} <= ${observedBy}` : sql``}
    ORDER BY ${quotes.effectiveDate} DESC, ${quotes.quotedAt} DESC, ${quotes.provider}
    LIMIT 1
  ) END`;
}
