import {
  DndContext,
  closestCenter,
  type DragEndEvent,
  type SensorDescriptor,
  type SensorOptions,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";

import { ScrollArea } from "@/components/ui/scroll-area";
import {
  OPTIONAL_WIDGET_METADATA,
  type WidgetMetadata,
} from "./widgetConstants";
import type { WidgetPreference } from "@shared/reports";
import { CustomizeDashboardSortableItem } from "./CustomizeDashboardSortableItem";

type CustomizeDashboardOptionalTabProps = {
  orderedOptional: WidgetPreference[];
  toggleOptional: (id: string, enabled: boolean) => void;
  handleDragEnd: (event: DragEndEvent) => void;
  sensors: SensorDescriptor<SensorOptions>[];
};

export function CustomizeDashboardOptionalTab({
  orderedOptional,
  toggleOptional,
  handleDragEnd,
  sensors,
}: CustomizeDashboardOptionalTabProps) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
      <p className="text-sm text-muted-foreground mb-4 flex-none">
        Drag to reorder. Uncheck to hide.
      </p>
      <ScrollArea className="flex-1 pr-4">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={orderedOptional.map((item) => item.id)}
            strategy={verticalListSortingStrategy}
          >
            {orderedOptional.map((item) => {
              const metadata = OPTIONAL_WIDGET_METADATA[item.id] as
                | WidgetMetadata
                | undefined;
              if (!metadata) return null;
              return (
                <CustomizeDashboardSortableItem
                  key={item.id}
                  id={item.id}
                  metadata={metadata}
                  enabled={item.enabled}
                  onToggle={(checked) => toggleOptional(item.id, checked)}
                />
              );
            })}
          </SortableContext>
        </DndContext>
      </ScrollArea>
    </div>
  );
}
