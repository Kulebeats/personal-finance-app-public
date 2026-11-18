import { GripVertical } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { Checkbox } from "@/components/ui/checkbox";
import type { WidgetMetadata } from "./widgetConstants";

type CustomizeDashboardSortableItemProps = {
  id: string;
  metadata: WidgetMetadata;
  enabled: boolean;
  onToggle: (checked: boolean) => void;
};

export function CustomizeDashboardSortableItem({
  id,
  metadata,
  enabled,
  onToggle,
}: CustomizeDashboardSortableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 1,
    opacity: isDragging ? 0.8 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center justify-between p-3 bg-card border rounded-md mb-2"
    >
      <div className="flex items-center gap-3">
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab hover:text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
          role="button"
          aria-label="Drag to reorder"
        >
          <GripVertical className="h-5 w-5 text-muted-foreground" />
        </div>
        <div>
          <p className="font-medium text-sm">{metadata.label}</p>
          <p className="text-xs text-muted-foreground">
            {metadata.description}
          </p>
        </div>
      </div>
      <Checkbox
        checked={enabled}
        onCheckedChange={(checked) => onToggle(!!checked)}
        aria-label={`Enable ${metadata.label}`}
      />
    </div>
  );
}
