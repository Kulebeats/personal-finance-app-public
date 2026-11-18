import { useState, useCallback } from 'react';
import { SETTINGS_SECTIONS, type SettingsSection } from '../constants/sectionNames';

interface UseSettingsNavigationOptions {
  defaultSection?: SettingsSection;
  onSectionChange?: (section: SettingsSection) => void;
}

interface UseSettingsNavigationReturn {
  activeSection: SettingsSection;
  setActiveSection: (section: SettingsSection) => void;
  navigateToSection: (section: SettingsSection) => void;
  isSection: (section: SettingsSection) => boolean;
}

export function useSettingsNavigation(
  options: UseSettingsNavigationOptions = {}
): UseSettingsNavigationReturn {
  const { defaultSection = SETTINGS_SECTIONS.PROFILE, onSectionChange } = options;
  
  const [activeSection, setActiveSectionState] = useState<SettingsSection>(defaultSection);

  const setActiveSection = useCallback((section: SettingsSection) => {
    setActiveSectionState(section);
    onSectionChange?.(section);
  }, [onSectionChange]);

  const navigateToSection = useCallback((section: SettingsSection) => {
    setActiveSection(section);
    // Update URL without page reload
    const url = new URL(window.location.href);
    url.searchParams.set('section', section);
    window.history.pushState({}, '', url.toString());
  }, [setActiveSection]);

  const isSection = useCallback((section: SettingsSection) => {
    return activeSection === section;
  }, [activeSection]);

  return {
    activeSection,
    setActiveSection,
    navigateToSection,
    isSection,
  };
}
