/**
 * Calculation Engine - Linear Forecasting
 *
 * Provides simple linear regression for forecasting trends based on historical data.
 *
 * @module core/calculations/projections/linearForecast
 */

import { Money, toMoney } from "../types";
import { roundToDecimals } from "../helpers";

export interface DataPoint {
  x: number; // e.g., timestamp or index
  y: number; // e.g., amount
}

export interface LinearForecastResult {
  slope: number;
  intercept: number;
  rSquared: number;
  predict: (x: number) => number;
}

/**
 * Calculates a linear regression model (y = mx + c) from data points.
 *
 * @param data - Array of x,y data points
 * @returns Linear forecast model
 */
export function calculateLinearForecast(
  data: DataPoint[]
): LinearForecastResult {
  const n = data.length;
  if (n < 2) {
    return {
      slope: 0,
      intercept: 0,
      rSquared: 0,
      predict: () => 0,
    };
  }

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  let sumYY = 0;

  for (const point of data) {
    sumX += point.x;
    sumY += point.y;
    sumXY += point.x * point.y;
    sumXX += point.x * point.x;
    sumYY += point.y * point.y;
  }

  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  // Calculate R-squared
  const ssTot = sumYY - (sumY * sumY) / n;
  const ssRes =
    sumYY - slope * sumXY - intercept * sumY + slope * sumX * intercept; // Simplified? No, standard formula is easier:
  // R^2 = (n*sumXY - sumX*sumY)^2 / ((n*sumXX - sumX^2)(n*sumYY - sumY^2))

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt(
    (n * sumXX - sumX * sumX) * (n * sumYY - sumY * sumY)
  );
  const rSquared = denominator === 0 ? 0 : Math.pow(numerator / denominator, 2);

  return {
    slope,
    intercept,
    rSquared: roundToDecimals(rSquared, 4),
    predict: (x: number) => {
      const y = slope * x + intercept;
      return roundToDecimals(y, 2);
    },
  };
}

/**
 * Forecasts future values based on historical amounts.
 * Assumes equal time intervals between historical values.
 *
 * @param historicalValues - Array of historical amounts (ordered oldest to newest)
 * @param periodsToForecast - Number of future periods to predict
 * @returns Array of forecasted amounts
 */
export function forecastFutureValues(
  historicalValues: number[],
  periodsToForecast: number
): Money[] {
  const data = historicalValues.map((y, i) => ({ x: i, y }));
  const model = calculateLinearForecast(data);

  const forecast: Money[] = [];
  const startX = historicalValues.length;

  for (let i = 0; i < periodsToForecast; i++) {
    const prediction = model.predict(startX + i);
    forecast.push(toMoney(prediction));
  }

  return forecast;
}
