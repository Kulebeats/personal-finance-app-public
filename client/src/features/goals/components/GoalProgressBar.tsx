import { cn } from "@/lib/utils";

const COLOR_CLASSES: Record<string, string> = {
  emerald: "bg-emerald-500",
  blue: "bg-blue-500",
  indigo: "bg-indigo-500",
  rose: "bg-rose-500",
  orange: "bg-orange-500",
  amber: "bg-amber-500",
  slate: "bg-slate-500",
};

function resolveIndicatorStyle(color?: string | null) {
  if (!color) {
    return { className: "bg-primary", style: {} };
  }

  if (color.startsWith("#")) {
    return { className: "", style: { backgroundColor: color } };
  }

  return { className: COLOR_CLASSES[color] ?? "bg-primary", style: {} };
}

export function GoalProgressBar({
  current,
  target,
  color,
}: {
  current: number;
  target: number;
  color?: string | null;
}) {
  const percent =
    target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  const indicator = resolveIndicatorStyle(color);

  return (
    <div
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-2 w-full bg-muted rounded-full overflow-hidden"
    >
      <div
        className={cn(
          "h-full rounded-full transition-all",
          indicator.className
        )}
        style={{ width: `${percent}%`, ...indicator.style }}
      />
    </div>
  );
}
