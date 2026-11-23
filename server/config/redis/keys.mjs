const refuse = () => { throw new Error('REDIS_KEY_REFUSED'); };
const check = value => { if (!value) refuse(); };
const run = /^[a-z][a-z0-9]{7,31}$/;
const prefix = /^pfa:production:([a-z][a-z0-9]{7,31}):$/;
const literals = /^[\x21-\x7e]{1,512}$/;
const tiers = new Set(['general', 'analytics', 'auth', 'ipauth', 'strict', 'expensive', 'upload']);
const endpoints = new Set(['dashboard', 'cashflow', 'spendingBreakdown', 'spendingTrend', 'annual', 'netWorth', 'sankey', 'income', 'savingsRate',
  'transactions', 'financialRatios', 'debtAnalysis', 'netWorthChanges', 'expenseClassification', 'goalsProgress', 'subcategoryBreakdown', 'forecast', 'customChart']);
const literal = value => { check(typeof value === 'string' && literals.test(value) && !/[\\[\]*?]/.test(value)); return value; };
const validPrefix = value => { check(typeof value === 'string' && prefix.test(value)); return value; };
function logical(value) {
  literal(value); check(!value.startsWith('pfa:'));
  const parts = value.split(':');
  check(parts.length >= 2 && parts[0] && (parts[0] === 'rl' ? tiers.has(parts[1]) && parts.length >= 3 :
    ['analytics', 'core-cache', 'ai', 'health', 'scheduler', 'snapshot'].includes(parts[0])));
  if (parts[0] === 'health') check(value.startsWith('health:readiness:'));
  if (parts[0] === 'scheduler') check(value.startsWith('scheduler:lock:'));
  return value;
}
/** Lexical transformation only. No parser result or string grants Redis admission. */
export function runKeyPrefix(runId) { check(typeof runId === 'string' && run.test(runId)); return `pfa:production:${runId}:`; }
export function physicalKey(runPrefix, logicalKey) { return validPrefix(runPrefix) + logical(logicalKey); }
export function logicalKeyFromPhysical(runPrefix, physical) {
  validPrefix(runPrefix); check(typeof physical === 'string' && physical.startsWith(runPrefix)); return logical(physical.slice(runPrefix.length));
}
export function prefixPattern(runPrefix, logicalPrefix) { return physicalKey(runPrefix, logicalPrefix) + '*'; }
function analyticsFilter(filter) {
  check(filter && typeof filter === 'object' && !Array.isArray(filter));
  check(Object.keys(filter).sort().join('|') === (filter.scope === 'household' ? 'householdId|scope' : 'endpoint|householdId|scope'));
  check(typeof filter.householdId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(filter.householdId));
  check(filter.scope === 'household' || filter.scope === 'endpoint' && endpoints.has(filter.endpoint));
  return filter;
}
export function analyticsLogicalPatterns(filter) {
  analyticsFilter(filter);
  const selected = filter.scope === 'household' ? '*' : filter.endpoint, root = `analytics:${selected}:${filter.householdId}:`;
  return Object.freeze([`${root}v1:*`, `${root}*:v1:*`]);
}
export function analyticsPatterns(runPrefix, filter) { validPrefix(runPrefix); return Object.freeze(analyticsLogicalPatterns(filter).map(pattern => runPrefix + pattern)); }
/** Redis '*' spans colons; a scan match alone never proves household membership. */
export function analyticsLogicalKeyMatches(key, filter) {
  analyticsFilter(filter); logical(key); const parts = key.split(':');
  if (parts[0] !== 'analytics' || !endpoints.has(parts[1]) || parts[2] !== filter.householdId || !/^[a-f0-9]{12}$/.test(parts.at(-1))) return false;
  if (!(parts.length === 5 && parts[3] === 'v1' || parts.length === 6 && /^[A-Za-z0-9_-]{1,128}$/.test(parts[3]) && parts[4] === 'v1')) return false;
  return filter.scope === 'household' || parts[1] === filter.endpoint;
}
export function analyticsKeyMatches(runPrefix, key, filter) { return analyticsLogicalKeyMatches(logicalKeyFromPhysical(runPrefix, key), filter); }
