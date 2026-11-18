/**
 * Calculation Engine - Metrics
 *
 * Provides interfaces and utilities for observability metrics.
 * Supports counters, histograms, and gauges for monitoring calculation performance.
 *
 * @module core/calculations/monitor/metrics
 */

import { logger } from "../../../utils/logger";

export interface MetricLabels {
  function: string;
  domain: string;
  mode: "operational" | "simulation" | "shadow";
  status: "success" | "error";
}

export interface Counter {
  inc(labels?: Partial<MetricLabels>, value?: number): void;
}

export interface Histogram {
  observe(labels: Partial<MetricLabels>, value: number): void;
}

export interface Gauge {
  set(labels: Partial<MetricLabels>, value: number): void;
  inc(labels?: Partial<MetricLabels>, value?: number): void;
  dec(labels?: Partial<MetricLabels>, value?: number): void;
}

export interface CalculationMetrics {
  // Counters
  calculationsTotal: Counter;
  calculationsErrorsTotal: Counter;
  cacheHitsTotal: Counter;
  cacheMissesTotal: Counter;

  // Histograms
  calculationDurationMs: Histogram;
  batchSizeDistribution: Histogram;

  // Gauges
  cacheSize: Gauge;
  activeCalculations: Gauge;
}

/**
 * Creates a no-op metrics collector for environments without observability.
 */
export function createNoOpMetrics(): CalculationMetrics {
  const noOpCounter: Counter = {
    inc: () => {},
  };

  const noOpHistogram: Histogram = {
    observe: () => {},
  };

  const noOpGauge: Gauge = {
    set: () => {},
    inc: () => {},
    dec: () => {},
  };

  return {
    calculationsTotal: noOpCounter,
    calculationsErrorsTotal: noOpCounter,
    cacheHitsTotal: noOpCounter,
    cacheMissesTotal: noOpCounter,
    calculationDurationMs: noOpHistogram,
    batchSizeDistribution: noOpHistogram,
    cacheSize: noOpGauge,
    activeCalculations: noOpGauge,
  };
}

/**
 * Creates an in-memory metrics collector for development/testing.
 * Logs metrics to console when threshold exceeded.
 */
export function createConsoleMetrics(): CalculationMetrics {
  const counters: Record<string, number> = {};
  const histograms: Record<string, number[]> = {};
  const gauges: Record<string, number> = {};

  const labelKey = (name: string, labels?: Partial<MetricLabels>) =>
    labels ? `${name}:${JSON.stringify(labels)}` : name;

  return {
    calculationsTotal: {
      inc: (labels, value = 1) => {
        const key = labelKey("calculationsTotal", labels);
        counters[key] = (counters[key] || 0) + value;
      },
    },
    calculationsErrorsTotal: {
      inc: (labels, value = 1) => {
        const key = labelKey("calculationsErrorsTotal", labels);
        counters[key] = (counters[key] || 0) + value;
        if (counters[key] > 10) {
          logger.warn("High calculation error count", {
            metric: "calculationsErrorsTotal",
            count: counters[key],
            ...labels,
          });
        }
      },
    },
    cacheHitsTotal: {
      inc: (labels, value = 1) => {
        const key = labelKey("cacheHitsTotal", labels);
        counters[key] = (counters[key] || 0) + value;
      },
    },
    cacheMissesTotal: {
      inc: (labels, value = 1) => {
        const key = labelKey("cacheMissesTotal", labels);
        counters[key] = (counters[key] || 0) + value;
      },
    },
    calculationDurationMs: {
      observe: (labels, value) => {
        const key = labelKey("calculationDurationMs", labels);
        if (!histograms[key]) histograms[key] = [];
        histograms[key].push(value);
        if (value > 100) {
          logger.warn("Slow calculation detected", {
            metric: "calculationDurationMs",
            duration: value,
            ...labels,
          });
        }
      },
    },
    batchSizeDistribution: {
      observe: (labels, value) => {
        const key = labelKey("batchSizeDistribution", labels);
        if (!histograms[key]) histograms[key] = [];
        histograms[key].push(value);
      },
    },
    cacheSize: {
      set: (labels, value) => {
        const key = labelKey("cacheSize", labels);
        gauges[key] = value;
      },
      inc: (labels, value = 1) => {
        const key = labelKey("cacheSize", labels);
        gauges[key] = (gauges[key] || 0) + value;
      },
      dec: (labels, value = 1) => {
        const key = labelKey("cacheSize", labels);
        gauges[key] = (gauges[key] || 0) - value;
      },
    },
    activeCalculations: {
      set: (labels, value) => {
        const key = labelKey("activeCalculations", labels);
        gauges[key] = value;
      },
      inc: (labels, value = 1) => {
        const key = labelKey("activeCalculations", labels);
        gauges[key] = (gauges[key] || 0) + value;
      },
      dec: (labels, value = 1) => {
        const key = labelKey("activeCalculations", labels);
        gauges[key] = (gauges[key] || 0) - value;
      },
    },
  };
}

/**
 * Wraps a calculation function with metrics collection.
 */
export function withMetrics<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => TReturn,
  metrics: CalculationMetrics,
  labels: Partial<MetricLabels>
): (...args: TArgs) => TReturn {
  return (...args: TArgs): TReturn => {
    const start = Date.now();
    metrics.activeCalculations.inc(labels);

    try {
      const result = fn(...args);

      // Handle async functions
      if (result instanceof Promise) {
        return result
          .then((res) => {
            metrics.calculationsTotal.inc({ ...labels, status: "success" });
            metrics.calculationDurationMs.observe(labels, Date.now() - start);
            metrics.activeCalculations.dec(labels);
            return res;
          })
          .catch((err) => {
            metrics.calculationsErrorsTotal.inc({ ...labels, status: "error" });
            metrics.calculationDurationMs.observe(labels, Date.now() - start);
            metrics.activeCalculations.dec(labels);
            throw err;
          }) as TReturn;
      }

      metrics.calculationsTotal.inc({ ...labels, status: "success" });
      metrics.calculationDurationMs.observe(labels, Date.now() - start);
      metrics.activeCalculations.dec(labels);
      return result;
    } catch (err) {
      metrics.calculationsErrorsTotal.inc({ ...labels, status: "error" });
      metrics.calculationDurationMs.observe(labels, Date.now() - start);
      metrics.activeCalculations.dec(labels);
      throw err;
    }
  };
}
