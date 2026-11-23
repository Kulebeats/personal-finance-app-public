import { useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertCircle, Loader2 } from "lucide-react";
import { NetWorthPoint, type AccountHistoryState } from "../types";
import { formatDenominatedAmount, isCurrencyCode } from "@shared/denomination";

interface NetWorthChartProps {
  data: NetWorthPoint[];
  currentNetWorth: number;
  isLoading: boolean;
  unavailable?: boolean;
  currency?: string;
  historyState?: AccountHistoryState;
  onRetryHistory?: () => void;
  children?: React.ReactNode;
}
const calendarDay = (date: string) => new Date(`${date}T12:00:00`);
const fullDate = (date: string) => new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(calendarDay(date));
const shortDate = (date: string) => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(calendarDay(date));
const money = (value: number, currency?: string) => formatDenominatedAmount(value, currency) ?? "Amount unavailable";

export function NetWorthChart({ data, currentNetWorth, isLoading, unavailable, currency, historyState, onRetryHistory, children }: NetWorthChartProps) {
  const [selectedCurrency, setSelectedCurrency] = useState<string | null>(null);
  const verified = data.filter((point): point is NetWorthPoint & { currency: string; provenance: "captured_snapshot" } =>
    point.provenance === "captured_snapshot" && isCurrencyCode(point.currency) && Number.isFinite(point.value) && /^\d{4}-\d{2}-\d{2}$/.test(point.date));
  const currencies = Array.from(new Set(verified.map(point => point.currency)));
  const historicalCurrency = selectedCurrency && currencies.includes(selectedCurrency) ? selectedCurrency
    : currency && currencies.includes(currency) ? currency : currencies[0];
  const points = verified.filter(point => point.currency === historicalCurrency);
  const state = historyState ?? (isLoading ? "checking" : "ready");
  return (
    <div className="bg-card rounded-xl border border-border shadow-sm p-6">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
            Net Worth <span aria-label="Visible account-linked wealth; legacy instruments without proven account access are not included">
              <AlertCircle className="w-3 h-3" aria-hidden="true" />
            </span>
          </div>
          <h1 className="text-3xl font-bold text-foreground">
            {state === "checking" ? <span className="flex items-center gap-2 text-base"><Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
              <span role="status">Checking current access…</span></span>
              : state === "error" ? <span role="alert" className="text-base">Unable to refresh account history. Refresh to try again.</span>
              : unavailable || !formatDenominatedAmount(currentNetWorth, currency) ? <span role="alert" className="text-base">Valuation unavailable. Refresh to try again.</span> : money(currentNetWorth, currency)}
          </h1>
        </div>
        <div className="flex gap-2">{children}</div>
      </div>
      {state === "error" && <button type="button" onClick={onRetryHistory}>Retry account history</button>}
      {state === "ready" && <>
      <p className="text-sm font-medium mt-4">Captured snapshot history</p>
      <p className="text-xs text-muted-foreground">Snapshot-only history. Independent balance history has unverified denomination and is not charted.</p>
      {currencies.length > 1 && <label className="text-sm">Historical currency
        <select aria-label="Historical currency" value={historicalCurrency} onChange={event => setSelectedCurrency(event.target.value)} className="ml-2 rounded border bg-background p-1">
          {currencies.map(code => <option key={code} value={code}>{code}</option>)}
        </select>
      </label>}
      {!points.length ? <p className="py-10 text-muted-foreground">No proven snapshots in this range</p> : <>
        <div className="h-[280px] w-full" role="img" aria-label={`Captured ${historicalCurrency} snapshots from ${fullDate(points[0].date)} to ${fullDate(points[points.length - 1].date)}`}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points}>
              <defs><linearGradient id="colorNw" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.15} />
                <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
              </linearGradient></defs>
              <XAxis dataKey="date" tickFormatter={shortDate} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} dy={10} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={value => money(value, historicalCurrency)} dx={-10} />
              <Tooltip labelFormatter={label => fullDate(String(label))}
                formatter={(value: number, _name, item) => [money(value, item.payload?.currency || historicalCurrency), "Captured Net Worth"]}
                contentStyle={{ borderRadius: "8px", border: "1px solid hsl(var(--border))", backgroundColor: "hsl(var(--card))" }} />
              <Area type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={3} fillOpacity={1} fill="url(#colorNw)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <table className="sr-only"><caption>All proven captured snapshots</caption>
          <thead><tr><th>Date</th><th>Net worth</th></tr></thead>
          <tbody>{verified.map(point => <tr key={`${point.date}-${point.currency}`}><td>{fullDate(point.date)}</td><td>{money(point.value, point.currency)}</td></tr>)}</tbody>
        </table>
      </>}
      </>}
    </div>
  );
}
