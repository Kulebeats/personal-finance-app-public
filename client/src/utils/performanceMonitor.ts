/**
 * Performance Monitoring Utility for Widgets
 *
 * Tracks render times and logs slow renders (>200ms)
 */

const SLOW_RENDER_THRESHOLD = 200; // ms

interface RenderMetric {
  widgetId: string;
  renderTime: number;
  timestamp: number;
}

class PerformanceMonitor {
  private metrics: RenderMetric[] = [];
  private enabled: boolean = process.env.NODE_ENV === "development";

  /**
   * Measure widget render time
   */
  startMeasure(widgetId: string): () => void {
    if (!this.enabled) return () => {};

    const start = performance.now();

    return () => {
      const renderTime = performance.now() - start;
      this.recordMetric(widgetId, renderTime);
    };
  }

  /**
   * Record a render metric
   */
  private recordMetric(widgetId: string, renderTime: number): void {
    const metric: RenderMetric = {
      widgetId,
      renderTime: Math.round(renderTime * 100) / 100,
      timestamp: Date.now(),
    };

    this.metrics.push(metric);

    // Keep only last 100 metrics to avoid memory bloat
    if (this.metrics.length > 100) {
      this.metrics.shift();
    }

    // Log slow renders
    if (renderTime > SLOW_RENDER_THRESHOLD) {
      console.warn(
        `[PerformanceMonitor] Slow render detected: ${widgetId} took ${metric.renderTime}ms`
      );
    }
  }

  /**
   * Get all collected metrics
   */
  getMetrics(): RenderMetric[] {
    return [...this.metrics];
  }

  /**
   * Get average render time for a widget
   */
  getAverageRenderTime(widgetId: string): number | null {
    const widgetMetrics = this.metrics.filter((m) => m.widgetId === widgetId);
    if (widgetMetrics.length === 0) return null;

    const total = widgetMetrics.reduce((sum, m) => sum + m.renderTime, 0);
    return Math.round((total / widgetMetrics.length) * 100) / 100;
  }

  /**
   * Get slow render count
   */
  getSlowRenderCount(): number {
    return this.metrics.filter((m) => m.renderTime > SLOW_RENDER_THRESHOLD)
      .length;
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics = [];
  }

  /**
   * Enable/disable monitoring
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
}

// Singleton instance
export const performanceMonitor = new PerformanceMonitor();

/**
 * React hook for measuring render performance
 */
export function useRenderPerformance(widgetId: string): void {
  const stopMeasure = performanceMonitor.startMeasure(widgetId);

  // Call stopMeasure on next tick (after render completes)
  requestAnimationFrame(() => {
    stopMeasure();
  });
}

export default performanceMonitor;
