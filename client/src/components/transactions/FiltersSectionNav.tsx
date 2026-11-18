import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { FilterSection } from "./filtersTypes";

type FiltersSectionNavProps = {
  sections: { key: FilterSection; label: string; count: number }[];
  activeSection: FilterSection;
  onSectionChange: (section: FilterSection) => void;
};

export function FiltersSectionNav({
  sections,
  activeSection,
  onSectionChange,
}: FiltersSectionNavProps) {
  return (
    <div className="w-48 border-r bg-muted/30 p-2 space-y-1">
      {sections.map((section) => (
        <button
          key={section.key}
          onClick={() => onSectionChange(section.key)}
          className={cn(
            "w-full flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors",
            activeSection === section.key
              ? "bg-background shadow-sm font-medium"
              : "hover:bg-background/50"
          )}
        >
          <span>{section.label}</span>
          {section.count > 0 && (
            <Badge variant="secondary" className="ml-2">
              {section.count}
            </Badge>
          )}
        </button>
      ))}
    </div>
  );
}
