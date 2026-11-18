/**
 * CashFlowSection Component
 *
 * Displays cash flow data as a Sankey diagram
 */

import { ResponsiveSankey, SankeyNodeDatum, SankeyLinkDatum } from "@nivo/sankey";
import { Loader2 } from "lucide-react";
import { PRIMARY_CHART_COLOR, chartTheme } from "../utils/chartTheme";
import { toMoneyNumber } from "@/lib/money";
import type { MoneyValue } from "@shared/money";

interface SankeyNode {
  id: string;
  label?: string;
  nodeColor?: string;
  entityType?: "categoryGroup" | "category" | "merchant" | "account" | "synthetic";
  entityId?: string;
}

interface SankeyLink {
  source: string;
  target: string;
  value: MoneyValue;
}

interface SankeyData {
  nodes: SankeyNode[];
  links: SankeyLink[];
}

interface CashFlowSectionProps {
  data: { sankey: SankeyData } | null;
  isLoading: boolean;
  onNodeClick?: (node: SankeyNodeDatum<SankeyNode, { source: string; target: string; value: number }> | SankeyLinkDatum<SankeyNode, { source: string; target: string; value: number }>) => void;
}

export function CashFlowSection({
  data,
  isLoading,
  onNodeClick,
}: CashFlowSectionProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data?.sankey) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        No cash flow data for this period.
      </div>
    );
  }

  const sankeyData = data?.sankey
    ? {
        nodes: data.sankey.nodes,
        links: data.sankey.links.map((link) => ({
          ...link,
          value: toMoneyNumber(link.value),
        })),
      }
    : null;

  return (
    <div
      className="h-full w-full"
      aria-label="Cash flow sankey diagram"
      role="img"
    >
      <ResponsiveSankey
        data={sankeyData ?? { nodes: [], links: [] }}
        margin={{ top: 20, right: 160, bottom: 20, left: 20 }}
        align="justify"
        colors={(node) => node.nodeColor || PRIMARY_CHART_COLOR}
        nodeOpacity={1}
        nodeHoverOthersOpacity={0.35}
        nodeThickness={18}
        nodeSpacing={24}
        nodeBorderWidth={0}
        nodeBorderColor={{
          from: "color",
          modifiers: [["darker", 0.8]],
        }}
        linkOpacity={0.3}
        linkHoverOthersOpacity={0.1}
        linkContract={3}
        enableLinkGradient={true}
        labelPosition="inside"
        labelOrientation="horizontal"
        labelPadding={16}
        label={(node) => {
          const n = node as SankeyNodeDatum<SankeyNode, { source: string; target: string; value: number }> & { label?: string };
          return n.label ?? n.id;
        }}
        labelTextColor={{
          from: "color",
          modifiers: [["darker", 1]],
        }}
        onClick={onNodeClick}
        theme={{
          ...chartTheme,
          text: {
            ...chartTheme.text,
            fill: "hsl(var(--foreground))",
            fontWeight: 600,
          },
        }}
      />
    </div>
  );
}
