import type { LucideIcon } from "lucide-react";

type AccountTypeCardProps = {
  icon: LucideIcon;
  label: string;
  sublabel: string;
  onClick: () => void;
};

export function AccountTypeCard({
  icon: Icon,
  label,
  sublabel,
  onClick,
}: AccountTypeCardProps) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center text-center p-4 rounded-xl border border-border bg-card hover:bg-muted/50 hover:border-primary/50 transition-all group h-full"
    >
      <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mb-3 group-hover:bg-background dark:group-hover:bg-slate-700 group-hover:shadow-sm group-hover:text-primary transition-all">
        <Icon className="w-6 h-6 text-muted-foreground group-hover:text-primary" aria-hidden="true" />
      </div>
      <span className="font-semibold text-sm text-foreground mb-1">{label}</span>
      <span className="text-xs text-muted-foreground">{sublabel}</span>
    </button>
  );
}
