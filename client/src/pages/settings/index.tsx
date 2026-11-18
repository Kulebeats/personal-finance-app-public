import React, { Suspense, lazy, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { SettingsLayout } from "./SettingsLayout";
import { LoadingSection } from "@/features/settings/components/LoadingSection";
import { ErrorBoundary } from "@/features/settings/components/ErrorBoundary";
import {
  SETTINGS_SECTIONS,
  type SettingsSection,
} from "@/features/settings/constants/sectionNames";

// Lazy load section components
const ProfileSection = lazy(() => import("./sections/ProfileSection"));
const DisplaySection = lazy(() => import("./sections/DisplaySection"));
const NotificationsSection = lazy(
  () => import("./sections/NotificationsSection")
);
const SecuritySection = lazy(() => import("./sections/SecuritySection"));
const HouseholdSection = lazy(() => import("./sections/HouseholdSection"));
const MembersSection = lazy(() => import("./sections/MembersSection"));
const OrganizationSection = lazy(
  () => import("./sections/OrganizationSection")
);
const MerchantsSection = lazy(() => import("./sections/MerchantsSection"));
const PreferencesSection = lazy(() => import("./sections/PreferencesSection"));
const WeeklyRecapSection = lazy(() => import("./sections/WeeklyRecapSection"));

interface SettingsPageProps {
  defaultSection?: SettingsSection;
}

const sectionComponents: Record<
  SettingsSection,
  React.LazyExoticComponent<React.ComponentType>
> = {
  [SETTINGS_SECTIONS.PROFILE]: ProfileSection,
  [SETTINGS_SECTIONS.DISPLAY]: DisplaySection,
  [SETTINGS_SECTIONS.NOTIFICATIONS]: NotificationsSection,
  [SETTINGS_SECTIONS.SECURITY]: SecuritySection,
  [SETTINGS_SECTIONS.HOUSEHOLD]: HouseholdSection,
  [SETTINGS_SECTIONS.MEMBERS]: MembersSection,
  [SETTINGS_SECTIONS.ORGANIZATION]: OrganizationSection,
  [SETTINGS_SECTIONS.MERCHANTS]: MerchantsSection,
  [SETTINGS_SECTIONS.PREFERENCES]: PreferencesSection,
  [SETTINGS_SECTIONS.WEEKLY_RECAP]: WeeklyRecapSection,
};

export default function SettingsPage({
  defaultSection = SETTINGS_SECTIONS.PROFILE,
}: SettingsPageProps) {
  const [location, setLocation] = useLocation();
  const [activeSection, setActiveSection] =
    useState<SettingsSection>(defaultSection);

  useEffect(() => {
    const match = location.match(/^\/settings\/([^/]+)/);
    if (match) {
      const sectionPath = match[1];

      // Handle legacy URLs: redirect categories/rules/tags to organization
      if (sectionPath === "categories" || sectionPath === "rules" || sectionPath === "tags") {
        setLocation(`/settings/organization/${sectionPath}`, { replace: true });
        setActiveSection(SETTINGS_SECTIONS.ORGANIZATION);
        return;
      }

      const section = sectionPath as SettingsSection;
      if (Object.values(SETTINGS_SECTIONS).includes(section)) {
        setActiveSection(section);
        return;
      }
    }

    setActiveSection(defaultSection);
  }, [location, defaultSection, setLocation]);

  const ActiveSectionComponent = sectionComponents[activeSection];

  return (
    <SettingsLayout
      activeSection={activeSection}
      onSectionChange={(section) => {
        setActiveSection(section);
        setLocation(`/settings/${section}`);
      }}
    >
      <ErrorBoundary sectionName={activeSection}>
        <Suspense fallback={<LoadingSection variant="form" />}>
          <ActiveSectionComponent />
        </Suspense>
      </ErrorBoundary>
    </SettingsLayout>
  );
}
