import React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { SettingsCardProps } from "../types/settings";

/**
 * SettingsCard - A reusable card wrapper for settings sections
 *
 * Provides consistent styling across all settings sections with support for:
 * - Title and optional description
 * - Optional action button/element in the header
 * - Loading state with skeleton placeholder
 *
 * @example
 * <SettingsCard
 *   title="Profile"
 *   description="Manage your personal information"
 *   action={<Button>Save</Button>}
 * >
 *   <ProfileForm />
 * </SettingsCard>
 */
export function SettingsCard({
  title,
  description,
  action,
  isLoading = false,
  children,
}: Readonly<SettingsCardProps>) {
  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div className="space-y-1.5">
          {isLoading ? (
            <>
              <Skeleton className="h-6 w-32" />
              {description && <Skeleton className="h-4 w-48" />}
            </>
          ) : (
            <>
              <h2 className="text-xl font-semibold leading-none tracking-tight">
                {title}
              </h2>
              {description && <CardDescription>{description}</CardDescription>}
            </>
          )}
        </div>
        {action && !isLoading && <div className="shrink-0">{action}</div>}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-3/4" />
          </div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

export type { SettingsCardProps } from "../types/settings";
