import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { GripVertical } from "lucide-react";
import type { DashboardWidgetConfig } from "@shared/schema";

export type WidgetConfig = DashboardWidgetConfig;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  widgets: WidgetConfig[];
  onToggleWidget: (id: string) => void;
};

export function CustomizeDashboardModal({ open, onOpenChange, widgets, onToggleWidget }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Customize dashboard</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Select the widgets you want to see on your dashboard
          </p>
        </DialogHeader>
        
        <div className="grid grid-cols-2 gap-4 py-4">
          {widgets.map((widget) => (
            <div 
              key={widget.id} 
              className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/10 hover:bg-muted/20 transition-colors"
            >
              <div className="flex items-center gap-3">
                <GripVertical className="w-4 h-4 text-muted-foreground/50 cursor-grab" />
                <span className="font-medium text-sm">{widget.label}</span>
              </div>
              <Switch 
                checked={widget.enabled} 
                onCheckedChange={() => onToggleWidget(widget.id)} 
              />
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
