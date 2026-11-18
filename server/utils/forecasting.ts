/**
 * Forecasting Utility for Annual Dashboard
 * Based on docs/ANNUAL_DASHBOARD_REQUIREMENTS.md Section 9.7
 *
 * Uses simple linear regression for projections with confidence intervals.
 */

export interface DataPoint {
  x: number; // Time index (0, 1, 2, ... representing months)
  y: number; // Value at that time
}

export interface LinearRegressionResult {
  slope: number;
  intercept: number;
  r2: number;
  standardError: number;
}

export interface ForecastPoint {
  month: string;
  predicted: number;
  lowerBound: number;
  upperBound: number;
}

/**
 * Performs simple linear regression on a set of data points
 */
export function linearRegression(points: DataPoint[]): LinearRegressionResult {
  const n = points.length;
  if (n < 2) {
    return { slope: 0, intercept: points[0]?.y ?? 0, r2: 0, standardError: 0 };
  }

  // Calculate means
  const sumX = points.reduce((acc, p) => acc + p.x, 0);
  const sumY = points.reduce((acc, p) => acc + p.y, 0);
  const meanX = sumX / n;
  const meanY = sumY / n;

  // Calculate slope and intercept
  let ssXY = 0;
  let ssXX = 0;
  let ssYY = 0;

  for (const p of points) {
    const dx = p.x - meanX;
    const dy = p.y - meanY;
    ssXY += dx * dy;
    ssXX += dx * dx;
    ssYY += dy * dy;
  }

  const slope = ssXX !== 0 ? ssXY / ssXX : 0;
  const intercept = meanY - slope * meanX;

  // Calculate R-squared
  const r2 = ssXX * ssYY !== 0 ? (ssXY * ssXY) / (ssXX * ssYY) : 0;

  // Calculate standard error of the estimate
  let ssResidual = 0;
  for (const p of points) {
    const predicted = intercept + slope * p.x;
    ssResidual += (p.y - predicted) ** 2;
  }
  const standardError = n > 2 ? Math.sqrt(ssResidual / (n - 2)) : 0;

  return { slope, intercept, r2, standardError };
}

/**
 * Get the t-value for a given confidence level and degrees of freedom
 * Using approximate values for common confidence levels
 */
function getTValue(confidenceLevel: number, df: number): number {
  // Approximate t-values for two-tailed test
  const tValues: Record<number, number[]> = {
    // [df1, df2, df3, ... for 90%, 95%, 99%]
    0.9: [6.314, 2.92, 2.353, 2.132, 2.015, 1.943, 1.895, 1.86, 1.833, 1.812],
    0.95: [
      12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
    ],
    0.99: [
      63.657, 9.925, 5.841, 4.604, 4.032, 3.707, 3.499, 3.355, 3.25, 3.169,
    ],
  };

  const closestConf =
    confidenceLevel >= 0.99 ? 0.99 : confidenceLevel >= 0.95 ? 0.95 : 0.9;
  const values = tValues[closestConf] ?? tValues[0.95]!;
  const idx = Math.min(df - 1, values.length - 1);
  return values[Math.max(0, idx)] ?? 2.0;
}

/**
 * Generate forecast projections with confidence intervals
 */
export function generateForecast(
  historicalData: DataPoint[],
  projectionMonths: number,
  confidenceLevel: number = 0.95
): {
  baseline: { months: number; average: number; trend: number };
  projection: ForecastPoint[];
  regression: LinearRegressionResult;
} {
  const regression = linearRegression(historicalData);
  const n = historicalData.length;
  const startMonth = n; // Start projection from the next month

  // Calculate baseline statistics
  const average = historicalData.reduce((acc, p) => acc + p.y, 0) / n;

  // Generate projections
  const tValue = getTValue(confidenceLevel, n - 2);
  const projection: ForecastPoint[] = [];

  // Calculate mean of x for confidence interval
  const meanX = historicalData.reduce((acc, p) => acc + p.x, 0) / n;
  const ssX = historicalData.reduce((acc, p) => acc + (p.x - meanX) ** 2, 0);

  for (let i = 0; i < projectionMonths; i++) {
    const x = startMonth + i;
    const predicted = regression.intercept + regression.slope * x;

    // Calculate prediction interval width
    const distanceFromMean = (x - meanX) ** 2;
    const predictionSE =
      regression.standardError * Math.sqrt(1 + 1 / n + distanceFromMean / ssX);
    const margin = tValue * predictionSE;

    // Generate month label (YYYY-MM format)
    const referenceDate = new Date();
    referenceDate.setMonth(referenceDate.getMonth() + i);
    const month = `${referenceDate.getFullYear()}-${String(
      referenceDate.getMonth() + 1
    ).padStart(2, "0")}`;

    projection.push({
      month,
      predicted: Math.max(0, predicted), // Don't allow negative predictions for most financial metrics
      lowerBound: Math.max(0, predicted - margin),
      upperBound: predicted + margin,
    });
  }

  return {
    baseline: {
      months: n,
      average,
      trend: regression.slope,
    },
    projection,
    regression,
  };
}

/**
 * Calculate moving average for smoothing
 */
export function movingAverage(data: number[], windowSize: number): number[] {
  if (windowSize <= 0 || data.length === 0) return [];

  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - windowSize + 1);
    const window = data.slice(start, i + 1);
    const avg = window.reduce((a, b) => a + b, 0) / window.length;
    result.push(avg);
  }
  return result;
}

/**
 * Calculate standard deviation
 */
export function standardDeviation(data: number[]): number {
  if (data.length < 2) return 0;
  const mean = data.reduce((a, b) => a + b, 0) / data.length;
  const squaredDiffs = data.map((x) => (x - mean) ** 2);
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / (data.length - 1);
  return Math.sqrt(variance);
}

/**
 * Classify an expense category as fixed, variable, or discretionary
 * Based on coefficient of variation (CV = stddev / mean)
 *
 * Fixed: CV < 0.15 (consistent amounts like rent, subscriptions)
 * Variable: CV >= 0.15 and CV < 0.5 (somewhat predictable like utilities)
 * Discretionary: CV >= 0.5 (highly variable like dining, entertainment)
 */
export function classifyExpense(
  amounts: number[]
): "fixed" | "variable" | "discretionary" {
  if (amounts.length < 2) return "variable";

  const nonZeroAmounts = amounts.filter((a) => a > 0);
  if (nonZeroAmounts.length < 2) return "discretionary";

  const mean =
    nonZeroAmounts.reduce((a, b) => a + b, 0) / nonZeroAmounts.length;
  if (mean === 0) return "discretionary";

  const stddev = standardDeviation(nonZeroAmounts);
  const cv = stddev / mean;

  if (cv < 0.15) return "fixed";
  if (cv < 0.5) return "variable";
  return "discretionary";
}
