import { Link } from "wouter";
import { ChevronRight } from "lucide-react";

export type Breadcrumb = {
  href: string;
  label: string;
};

type BreadcrumbsProps = {
  breadcrumbs: Breadcrumb[];
};

export function Breadcrumbs({ breadcrumbs }: BreadcrumbsProps) {
  if (breadcrumbs.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center text-sm text-muted-foreground mr-4">
      {breadcrumbs.map((crumb, index) => {
        const isLast = index === breadcrumbs.length - 1;
        return (
          <div key={crumb.href} className="flex items-center">
            {index > 0 && (
              <ChevronRight className="w-4 h-4 mx-1 opacity-50" />
            )}
            {isLast ? (
              <span className="font-semibold text-foreground flex items-center gap-2">
                {crumb.label}
              </span>
            ) : (
              <Link
                href={crumb.href}
                className="hover:text-foreground transition-colors"
              >
                {crumb.label}
              </Link>
            )}
          </div>
        );
      })}
    </div>
  );
}
