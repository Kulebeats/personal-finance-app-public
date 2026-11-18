import React, { memo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  MoreHorizontal,
  Edit,
  Trash2,
  Archive,
  ArchiveRestore,
  ArrowUp,
  ArrowDown,
  DollarSign,
  Hash,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import type { Category } from "@/hooks/use-settings";

interface CategoryItemProps {
  category: Category;
  onEdit: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canDelete: boolean;
}

// Task 15.3: Apply React.memo to prevent re-rendering unchanged items
export const CategoryItem = memo<CategoryItemProps>(
  ({
    category,
    onEdit,
    onArchive,
    onRestore,
    onDelete,
    onMoveUp,
    onMoveDown,
    canDelete,
  }) => {
    const budgetValue = category.budget ?? 0;
    const spentValue = category.spent ?? 0;
    const budgetProgress = budgetValue ? (spentValue / budgetValue) * 100 : 0;
    const isOverBudget = budgetValue > 0 && spentValue > budgetValue;
    const transactionCount = category.transactionCount ?? 0;

    const formatCurrency = (amount: number) => {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(amount);
    };

    return (
      <Card
        className={`transition-colors ${
          category.isArchived ? "opacity-60" : ""
        }`}
      >
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            {/* Category Icon and Color */}
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 transition-colors bg-muted"
              style={{
                backgroundColor: category.color
                  ? `${category.color}20`
                  : undefined,
                color: category.color || undefined,
              }}
            >
              {category.icon ? (
                <span className="text-xl leading-none select-none filter drop-shadow-sm">
                  {category.icon}
                </span>
              ) : (
                <span className="text-sm font-semibold">
                  {category.name.charAt(0).toUpperCase()}
                </span>
              )}
            </div>

            {/* Category Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-medium truncate">{category.name}</h3>
                <Badge variant="outline" className="text-xs">
                  {category.groupName}
                </Badge>
                {category.isArchived && (
                  <Badge variant="secondary" className="text-xs">
                    Archived
                  </Badge>
                )}
              </div>

              <div className="flex items-center gap-4 text-sm text-muted-foreground mb-2">
                <span className="flex items-center gap-1">
                  <DollarSign className="h-3 w-3" />
                  Spent: {formatCurrency(spentValue)}
                </span>

                {budgetValue > 0 && (
                  <span className="flex items-center gap-1">
                    Budget: {formatCurrency(budgetValue)}
                  </span>
                )}

                <span className="flex items-center gap-1">
                  <Hash className="h-3 w-3" />
                  {transactionCount} transaction
                  {transactionCount !== 1 ? "s" : ""}
                </span>
              </div>

              {/* Budget Progress */}
              {budgetValue > 0 && (
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span
                      className={
                        isOverBudget
                          ? "text-destructive"
                          : "text-muted-foreground"
                      }
                    >
                      {budgetProgress.toFixed(1)}% of budget used
                    </span>
                    {isOverBudget && (
                      <span className="text-destructive font-medium">
                        Over by {formatCurrency(spentValue - budgetValue)}
                      </span>
                    )}
                  </div>
                  <Progress
                    value={Math.min(budgetProgress, 100)}
                    className={`h-2 ${
                      isOverBudget ? "[&>div]:bg-destructive" : ""
                    }`}
                  />
                </div>
              )}
            </div>

            {/* Actions Menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <MoreHorizontal className="h-4 w-4" />
                  <span className="sr-only">Open menu for {category.name}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onEdit}>
                  <Edit className="h-4 w-4 mr-2" />
                  Edit
                </DropdownMenuItem>
                {onMoveUp && (
                  <DropdownMenuItem onClick={onMoveUp}>
                    <ArrowUp className="h-4 w-4 mr-2" />
                    Move Up
                  </DropdownMenuItem>
                )}
                {onMoveDown && (
                  <DropdownMenuItem onClick={onMoveDown}>
                    <ArrowDown className="h-4 w-4 mr-2" />
                    Move Down
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                {category.isArchived ? (
                  <DropdownMenuItem onClick={onRestore}>
                    <ArchiveRestore className="h-4 w-4 mr-2" />
                    Restore
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={onArchive}>
                    <Archive className="h-4 w-4 mr-2" />
                    Archive
                  </DropdownMenuItem>
                )}
                {canDelete && (
                  <DropdownMenuItem
                    onClick={onDelete}
                    className="text-destructive"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardContent>
      </Card>
    );
  },
);

CategoryItem.displayName = "CategoryItem";
