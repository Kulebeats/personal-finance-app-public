import { useCurrentYearRange, useReportsCustom } from "@/hooks/use-reports";
import {
  CUSTOM_CHART_AGGREGATIONS,
  canUseCustomChartMetric,
  customChartComparison,
  customChartGroup,
  customChartPeriod,
  type CustomChartConfig,
} from "@shared/reports";

export function useCustomChartData(config: CustomChartConfig) {
  const { from, to } = useCurrentYearRange();
  const supportedMetric = canUseCustomChartMetric(config.primaryMetric);
  const groupBy = customChartGroup(config.primaryMetric, config.groupBy);
  const secondaryMetric = customChartComparison(config.primaryMetric, groupBy, config.secondaryMetric);
  const query = useReportsCustom({
    chartType: config.chartType,
    primaryMetric: config.primaryMetric,
    secondaryMetric,
    groupBy,
    period: groupBy ? undefined : customChartPeriod(config),
    aggregation: CUSTOM_CHART_AGGREGATIONS.find(operation => operation === config.aggregation),
    from,
    to,
  }, { enabled: supportedMetric });

  return { query, supportedMetric, groupBy, secondaryMetric };
}
