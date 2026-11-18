import { Checkbox } from "@/components/ui/checkbox";
import { CORE_WIDGET_METADATA } from "./widgetConstants";
import type { ReportWidgetPreferences } from "@shared/reports";

type CustomizeDashboardCoreTabProps = {
  localPrefs: ReportWidgetPreferences;
  toggleCore: (id: string, enabled: boolean) => void;
};

export function CustomizeDashboardCoreTab({
  localPrefs,
  toggleCore,
}: CustomizeDashboardCoreTabProps) {
  return (
    <div className="flex-1 overflow-hidden">
      <p className="text-sm text-muted-foreground mb-4">
        Toggle visibility of core dashboard elements.
      </p>
      {Object.values(CORE_WIDGET_METADATA).map((meta) => {
        const enabled = localPrefs.coreWidgets?.[meta.id]?.enabled ?? true;
        return (
          <div
            key={meta.id}
            className="flex items-center justify-between p-3 bg-muted/40 border rounded-md mb-2"
          >
            <div>
              <p className="font-medium text-sm">{meta.label}</p>
              <p className="text-xs text-muted-foreground">
                {meta.description}
              </p>
            </div>
            <Checkbox
              checked={enabled}
              disabled={meta.isLocked}
              onCheckedChange={(checked) => toggleCore(meta.id, !!checked)}
            />
          </div>
        );
      })}
    </div>
  );
}
