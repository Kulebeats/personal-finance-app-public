import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";

import {
  CORE_WIDGET_METADATA,
  OPTIONAL_WIDGET_METADATA,
} from "./widgetConstants";
import {
  ReportWidgetPreferences,
  CustomChartConfig,
  WidgetPreference,
} from "@shared/reports";
import { CustomizeDashboardOptionalTab } from "./CustomizeDashboardOptionalTab";
import { CustomizeDashboardCoreTab } from "./CustomizeDashboardCoreTab";
import { CustomizeDashboardCustomTab } from "./CustomizeDashboardCustomTab";

interface CustomizeDashboardModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preferences: ReportWidgetPreferences;
  onSave: (prefs: ReportWidgetPreferences) => void;
  onReset: () => void;
  customCharts: CustomChartConfig[];
  onEditCustomChart: (chart: CustomChartConfig) => void;
  onDeleteCustomChart: (id: string) => void;
}

export function CustomizeDashboardModal({
  open,
  onOpenChange,
  preferences,
  onSave,
  onReset,
  customCharts,
  onEditCustomChart,
  onDeleteCustomChart,
}: CustomizeDashboardModalProps) {
  const [localPrefs, setLocalPrefs] =
    useState<ReportWidgetPreferences>(preferences);

  useEffect(() => {
    setLocalPrefs(preferences);
  }, [preferences, open]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const getOrderedOptionalWidgets = () => {
    const widgets = { ...localPrefs.optionalWidgets };

    Object.keys(widgets).forEach((key) => {
      if (widgets[key] && !widgets[key].id) {
        widgets[key] = { ...widgets[key], id: key };
      }
    });

    Object.keys(OPTIONAL_WIDGET_METADATA).forEach((key) => {
      if (!widgets[key]) {
        widgets[key] = {
          id: key,
          enabled: true,
          order: OPTIONAL_WIDGET_METADATA[key].defaultOrder,
        };
      }
    });

    return Object.values(widgets).sort(
      (a: WidgetPreference, b: WidgetPreference) => a.order - b.order
    );
  };

  const [orderedOptional, setOrderedOptional] = useState<WidgetPreference[]>(
    getOrderedOptionalWidgets()
  );

  useEffect(() => {
    setOrderedOptional(getOrderedOptionalWidgets());
  }, [localPrefs.optionalWidgets]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setOrderedOptional((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id);
        const newIndex = items.findIndex((item) => item.id === over.id);
        const newOrder = arrayMove(items, oldIndex, newIndex);

        const updatedWidgets = { ...localPrefs.optionalWidgets };

        newOrder.forEach((item, index) => {
          updatedWidgets[item.id] = {
            ...item,
            order: index,
          };
        });

        setLocalPrefs((prev) => ({
          ...prev,
          optionalWidgets: updatedWidgets,
        }));

        return newOrder;
      });
    }
  };

  const toggleOptional = (id: string, enabled: boolean) => {
    setLocalPrefs((prev) => {
      const existing = prev.optionalWidgets?.[id];
      const widget = existing || {
        id,
        enabled,
        order: OPTIONAL_WIDGET_METADATA[id]?.defaultOrder ?? 0,
        chartType: "default",
      };

      return {
        ...prev,
        optionalWidgets: {
          ...prev.optionalWidgets,
          [id]: { ...widget, enabled },
        },
      };
    });
  };

  const toggleCore = (id: string, enabled: boolean) => {
    setLocalPrefs((prev) => {
      const existing = prev.coreWidgets?.[id];
      const widget = existing || {
        id,
        enabled,
        order: CORE_WIDGET_METADATA[id]?.defaultOrder ?? 0,
        chartType: "active",
      };

      return {
        ...prev,
        coreWidgets: {
          ...prev.coreWidgets,
          [id]: { ...widget, enabled },
        },
      };
    });
  };

  const handleSave = () => {
    onSave(localPrefs);
    onOpenChange(false);
  };

  const handleReset = () => {
    onReset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Customize Dashboard</DialogTitle>
          <DialogDescription>
            Manage visibility and order of your dashboard widgets.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden">
          <Tabs defaultValue="optional" className="h-full flex flex-col">
            <TabsList className="mb-4">
              <TabsTrigger value="optional">Analysis Widgets</TabsTrigger>
              <TabsTrigger value="core">Core Widgets</TabsTrigger>
              <TabsTrigger value="custom">Custom Charts</TabsTrigger>
            </TabsList>

            <TabsContent
              value="optional"
              className="flex-1 flex flex-col overflow-hidden min-h-0"
            >
              <CustomizeDashboardOptionalTab
                orderedOptional={orderedOptional}
                toggleOptional={toggleOptional}
                handleDragEnd={handleDragEnd}
                sensors={sensors}
              />
            </TabsContent>

            <TabsContent value="core" className="flex-1 overflow-hidden">
              <CustomizeDashboardCoreTab
                localPrefs={localPrefs}
                toggleCore={toggleCore}
              />
            </TabsContent>

            <TabsContent value="custom" className="flex-1 overflow-hidden">
              <CustomizeDashboardCustomTab
                customCharts={customCharts}
                onEditCustomChart={onEditCustomChart}
                onDeleteCustomChart={onDeleteCustomChart}
                onClose={() => onOpenChange(false)}
              />
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter className="mt-4">
          <div className="flex justify-between w-full">
            <Button
              variant="outline"
              className="text-destructive"
              onClick={handleReset}
            >
              Reset Defaults
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave}>Save Changes</Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
