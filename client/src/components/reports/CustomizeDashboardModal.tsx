import React, { useState, useEffect, useRef, useMemo } from "react";
import { assertOperationLifetime, captureOperationLifetime } from "@/lib/operation-lifetime";
import { identifyWidgetPreferences } from "@/lib/report-preference-response";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  ReportWidgetPreferencesPatch,
  CustomChartConfig,
  WidgetPreference,
} from "@shared/reports";
import { CustomizeDashboardOptionalTab } from "./CustomizeDashboardOptionalTab";
import { CustomizeDashboardCoreTab } from "./CustomizeDashboardCoreTab";
import { CustomizeDashboardCustomTab } from "./CustomizeDashboardCustomTab";
import { CustomizeDashboardFooter } from "./CustomizeDashboardFooter";

interface CustomizeDashboardModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preferences: ReportWidgetPreferences;
  onSave: (prefs: ReportWidgetPreferencesPatch) => Promise<ReportWidgetPreferences>;
  onReset: () => Promise<ReportWidgetPreferences>;
  customCharts: CustomChartConfig[];
  onEditCustomChart: (chart: CustomChartConfig) => void;
  onDeleteCustomChart: (id: string) => Promise<unknown>;
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
  const [basePrefs, setBasePrefs] =
    useState<ReportWidgetPreferences>(preferences);
  const [patch, setPatch] = useState<ReportWidgetPreferencesPatch>({});
  const patchRef = useRef(patch);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [failedReset, setFailedReset] = useState(false);
  const generation = useRef(0);
  const pending = useRef(false);
  const operation = useRef(captureOperationLifetime());

  useEffect(() => {
    setBasePrefs(preferences);
  }, [preferences]);

  useEffect(() => {
    generation.current += 1;
    patchRef.current = {};
    setPatch({});
    setSaveError(null);
    pending.current = false;
    setSaving(false);
    setResetting(false);
    setFailedReset(false);
    return () => { generation.current += 1; };
  }, [open]);

  // Defaults here are for presentation only. The request contains edited fields only.
  const localPrefs = useMemo(() => {
    const merged = { ...basePrefs };
    for (const section of ["coreWidgets", "optionalWidgets"] as const) {
      merged[section] = { ...basePrefs[section] };
      const metadata = section === "coreWidgets" ? CORE_WIDGET_METADATA : OPTIONAL_WIDGET_METADATA;
      for (const [id, changes] of Object.entries(patch[section] || {})) {
        merged[section][id] = Object.assign({
          id, enabled: true, order: metadata[id]?.defaultOrder ?? 0,
        }, basePrefs[section][id], changes);
      }
    }
    return merged;
  }, [basePrefs, patch]);

  const changeWidgets = (section: "coreWidgets" | "optionalWidgets", changes: Record<string, Partial<WidgetPreference>>) => {
    if (resetting) return;
    const next = { ...patchRef.current, [section]: { ...patchRef.current[section] } };
    for (const [id, fields] of Object.entries(changes)) {
      next[section]![id] = { ...next[section]![id], ...fields };
    }
    patchRef.current = next;
    setPatch(next);
  };

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const getOrderedOptionalWidgets = () => {
    const widgets = { ...localPrefs.optionalWidgets };

    Object.keys(OPTIONAL_WIDGET_METADATA).forEach((key) => {
      if (!widgets[key]) {
        widgets[key] = {
          id: key,
          enabled: true,
          order: OPTIONAL_WIDGET_METADATA[key].defaultOrder,
        };
      }
    });

    return identifyWidgetPreferences(widgets).sort((a, b) => a.order - b.order);
  };

  const orderedOptional = getOrderedOptionalWidgets();

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = orderedOptional.findIndex((item) => item.id === active.id);
      const newIndex = orderedOptional.findIndex((item) => item.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return;
      const changes: Record<string, Partial<WidgetPreference>> = {};
      arrayMove(orderedOptional, oldIndex, newIndex).forEach((item, index) => {
        if (item.order !== index) changes[item.id] = { order: index };
      });
      changeWidgets("optionalWidgets", changes);
    }
  };

  const toggleOptional = (id: string, enabled: boolean) => {
    changeWidgets("optionalWidgets", { [id]: { enabled } });
  };

  const toggleCore = (id: string, enabled: boolean) => {
    changeWidgets("coreWidgets", { [id]: { enabled } });
  };

  const handleSave = async () => {
    if (pending.current) return;
    try { assertOperationLifetime(operation.current); } catch { return; }
    const submittedDraft = patchRef.current;
    const request: ReportWidgetPreferencesPatch = {};
    for (const section of ["coreWidgets", "optionalWidgets"] as const) {
      const changed: Record<string, Partial<WidgetPreference>> = {};
      const metadata = section === "coreWidgets" ? CORE_WIDGET_METADATA : OPTIONAL_WIDGET_METADATA;
      for (const [id, fields] of Object.entries(patchRef.current[section] || {})) {
        const baseline = basePrefs[section][id] || { enabled: true, order: metadata[id]?.defaultOrder ?? 0 };
        const differences = Object.fromEntries(Object.entries(fields).filter(([field, value]) => value !== baseline[field as keyof typeof baseline]));
        if (Object.keys(differences).length) {
          changed[id] = basePrefs[section][id] ? differences : {
            enabled: true,
            order: metadata[id]?.defaultOrder ?? 0,
            chartType: section === "coreWidgets" ? "active" : "default",
            ...differences,
          };
        }
      }
      if (Object.keys(changed).length) request[section] = changed;
    }
    if (!Object.keys(request).length) { onOpenChange(false); return; }
    const started = generation.current;
    pending.current = true;
    setSaving(true);
    setSaveError(null);
    setFailedReset(false);
    try {
      assertOperationLifetime(operation.current);
      const acknowledged = await onSave(request);
      if (started !== generation.current) return;
      assertOperationLifetime(operation.current);
      const remaining: ReportWidgetPreferencesPatch = {};
      for (const section of ["coreWidgets", "optionalWidgets"] as const) {
        for (const [id, fields] of Object.entries(patchRef.current[section] || {})) {
          const unsaved = Object.fromEntries(Object.entries(fields).filter(([field, value]) => value !== submittedDraft[section]?.[id]?.[field as keyof WidgetPreference]));
          if (Object.keys(unsaved).length) {
            remaining[section] ??= {};
            remaining[section]![id] = unsaved;
          }
        }
      }
      setBasePrefs(acknowledged);
      patchRef.current = remaining;
      setPatch(remaining);
      if (!Object.keys(remaining).length) onOpenChange(false);
    } catch (error) {
      if (started !== generation.current) return;
      try { assertOperationLifetime(operation.current); } catch { return; }
      setSaveError(error instanceof Error ? error.message : "Unable to save dashboard preferences");
    } finally {
      try { assertOperationLifetime(operation.current); } catch { return; }
      if (started === generation.current) { pending.current = false; setSaving(false); }
    }
  };

  const handleReset = async () => {
    if (pending.current) return;
    const started = generation.current;
    try { assertOperationLifetime(operation.current); } catch { return; }
    pending.current = true;
    setSaving(true); setResetting(true); setSaveError(null);
    try {
      await onReset();
      if (started !== generation.current) return;
      assertOperationLifetime(operation.current);
      onOpenChange(false);
    } catch (error) {
      if (started !== generation.current) return;
      try { assertOperationLifetime(operation.current); } catch { return; }
      setFailedReset(true);
      setSaveError(error instanceof Error ? error.message : "Unable to reset dashboard preferences. Please retry.");
    } finally {
      try { assertOperationLifetime(operation.current); } catch { return; }
      if (started === generation.current) { pending.current = false; setSaving(false); setResetting(false); }
    }
  };

  return (
    <Dialog open={open} onOpenChange={next => { if (!resetting) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-[700px] h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Customize Dashboard</DialogTitle>
          <DialogDescription>
            Manage visibility and order of your dashboard widgets. Reset restores the default layout. Custom charts are retained.
          </DialogDescription>
        </DialogHeader>

        <fieldset disabled={resetting} className="flex-1 overflow-hidden">
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
        </fieldset>
        <CustomizeDashboardFooter
          saving={saving}
          resetting={resetting}
          failedReset={failedReset}
          error={saveError}
          onSave={handleSave}
          onReset={handleReset}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
