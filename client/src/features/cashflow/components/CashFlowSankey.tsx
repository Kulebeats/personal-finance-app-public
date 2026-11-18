import { ResponsiveSankey } from "@nivo/sankey";
import { type useCashFlowData } from "../hooks/useCashFlowData";
import { CASH_FLOW_CHART_COLORS } from "./chartTokens";

interface CashFlowSankeyProps {
  data: ReturnType<typeof useCashFlowData>["sankeyChartData"];
}

/**
 * Nivo Sankey diagram, split into its own module so the heavy `@nivo/sankey`
 * bundle is only fetched when the user actually switches to the Sankey view.
 * Lazy-loaded from {@link CashFlowChart}.
 */
export default function CashFlowSankey({ data }: CashFlowSankeyProps) {
  return (
    <ResponsiveSankey
      data={data}
      margin={{
        top: 10,
        right: window.innerWidth < 640 ? 8 : 20,
        bottom: 10,
        left: window.innerWidth < 640 ? 8 : 20,
      }}
      align="justify"
      colors={(node) => node.nodeColor || CASH_FLOW_CHART_COLORS.sankeyFallback}
      nodeOpacity={1}
      nodeHoverOthersOpacity={0.35}
      nodeThickness={window.innerWidth < 640 ? 14 : 18}
      nodeSpacing={window.innerWidth < 640 ? 16 : 24}
      nodeBorderWidth={0}
      nodeBorderColor={{
        from: "color",
        modifiers: [["darker", 0.8]],
      }}
      linkOpacity={0.5}
      linkHoverOthersOpacity={0.1}
      enableLinkGradient={true}
      labelPosition="inside"
      labelOrientation="horizontal"
      labelPadding={16}
      label={(node) => (node as { id: string; label?: string }).label ?? node.id}
      labelTextColor={{ from: "color", modifiers: [["darker", 1]] }}
      theme={{
        text: { fill: "hsl(var(--foreground))", fontWeight: 600 },
        tooltip: {
          container: {
            background: "hsl(var(--popover))",
            color: "hsl(var(--popover-foreground))",
            fontSize: "12px",
            borderRadius: "var(--radius)",
            boxShadow: "var(--shadow-md)",
            border: "1px solid hsl(var(--border))",
          },
        },
      }}
    />
  );
}
