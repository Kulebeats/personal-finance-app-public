export type AnalyticsEndpoint = 'dashboard' | 'cashflow' | 'spendingBreakdown' | 'spendingTrend' | 'annual' | 'netWorth' | 'sankey' | 'income' | 'savingsRate' |
  'transactions' | 'financialRatios' | 'debtAnalysis' | 'netWorthChanges' | 'expenseClassification' | 'goalsProgress' | 'subcategoryBreakdown' | 'forecast' | 'customChart';
export type AnalyticsInvalidation = Readonly<{ scope: 'household'; householdId: string }> | Readonly<{ scope: 'endpoint'; endpoint: AnalyticsEndpoint; householdId: string }>;
export function runKeyPrefix(runId: string): string;
export function physicalKey(runPrefix: string, logicalKey: string): string;
export function logicalKeyFromPhysical(runPrefix: string, physical: string): string;
export function prefixPattern(runPrefix: string, logicalPrefix: string): string;
export function analyticsPatterns(runPrefix: string, filter: AnalyticsInvalidation): readonly string[];
export function analyticsLogicalPatterns(filter: AnalyticsInvalidation): readonly string[];
export function analyticsKeyMatches(runPrefix: string, physicalKey: string, filter: AnalyticsInvalidation): boolean;
export function analyticsLogicalKeyMatches(logicalKey: string, filter: AnalyticsInvalidation): boolean;
