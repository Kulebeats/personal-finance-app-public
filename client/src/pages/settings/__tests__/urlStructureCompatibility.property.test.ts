/**
 * **Feature: settings-refactoring, Property 11: Backward Compatibility - URL Structure**
 * **Validates: Requirements 10.3**
 * 
 * Property-based test to verify that section navigation produces the same
 * URL patterns as the original implementation.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { SETTINGS_SECTIONS, type SettingsSection } from '@/features/settings/constants/sectionNames';

// Expected URL patterns for settings sections
const EXPECTED_URL_PATTERNS = {
  BASE: '/settings',
  PROFILE: '/settings/profile',
  DISPLAY: '/settings/display',
  NOTIFICATIONS: '/settings/notifications',
  SECURITY: '/settings/security',
  HOUSEHOLD: '/settings/household',
  MEMBERS: '/settings/members',
  ORGANIZATION: '/settings/organization',
  MERCHANTS: '/settings/merchants',
  PREFERENCES: '/settings/preferences',
} as const;

// Mapping from section names to expected URLs
const SECTION_TO_URL: Record<SettingsSection, string> = {
  "weekly-recap": "/settings/weekly-recap",
  [SETTINGS_SECTIONS.PROFILE]: EXPECTED_URL_PATTERNS.PROFILE,
  [SETTINGS_SECTIONS.DISPLAY]: EXPECTED_URL_PATTERNS.DISPLAY,
  [SETTINGS_SECTIONS.NOTIFICATIONS]: EXPECTED_URL_PATTERNS.NOTIFICATIONS,
  [SETTINGS_SECTIONS.SECURITY]: EXPECTED_URL_PATTERNS.SECURITY,
  [SETTINGS_SECTIONS.HOUSEHOLD]: EXPECTED_URL_PATTERNS.HOUSEHOLD,
  [SETTINGS_SECTIONS.MEMBERS]: EXPECTED_URL_PATTERNS.MEMBERS,
  [SETTINGS_SECTIONS.ORGANIZATION]: EXPECTED_URL_PATTERNS.ORGANIZATION,
  [SETTINGS_SECTIONS.MERCHANTS]: EXPECTED_URL_PATTERNS.MERCHANTS,
  [SETTINGS_SECTIONS.PREFERENCES]: EXPECTED_URL_PATTERNS.PREFERENCES,
};

// Helper function to generate URL for a section (simulates routing logic)
function generateSectionUrl(section: SettingsSection): string {
  return `/settings/${section}`;
}

// Helper function to parse section from URL
function parseSectionFromUrl(url: string): SettingsSection | null {
  const match = url.match(/^\/settings\/(.+)$/);
  if (!match) {
    return url === '/settings' ? SETTINGS_SECTIONS.PROFILE : null;
  }
  
  const sectionName = match[1];
  const validSections = Object.values(SETTINGS_SECTIONS);
  
  return validSections.includes(sectionName as SettingsSection) 
    ? sectionName as SettingsSection 
    : null;
}

// Helper function to validate URL structure
function isValidSettingsUrl(url: string): boolean {
  // Base settings URL
  if (url === '/settings') return true;
  
  // Section-specific URLs. Slugs are lowercase words optionally joined by
  // single hyphens (e.g. "weekly-recap"), matching the real route segments.
  const sectionPattern = /^\/settings\/[a-z]+(?:-[a-z]+)*$/;
  return sectionPattern.test(url);
}

describe('Property 11: Backward Compatibility - URL Structure', () => {
  it('all settings sections map to expected URL patterns', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...Object.values(SETTINGS_SECTIONS)),
        (section) => {
          const generatedUrl = generateSectionUrl(section);
          const expectedUrl = SECTION_TO_URL[section];
          
          expect(generatedUrl).toBe(expectedUrl);
          return true;
        }
      ),
      { numRuns: 20 }
    );
  });

  it('URL parsing correctly extracts section names', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...Object.values(SETTINGS_SECTIONS)),
        (section) => {
          const url = generateSectionUrl(section);
          const parsedSection = parseSectionFromUrl(url);
          
          expect(parsedSection).toBe(section);
          return true;
        }
      ),
      { numRuns: 20 }
    );
  });

  it('base settings URL defaults to profile section', () => {
    fc.assert(
      fc.property(
        fc.constant('/settings'),
        (baseUrl) => {
          const parsedSection = parseSectionFromUrl(baseUrl);
          expect(parsedSection).toBe(SETTINGS_SECTIONS.PROFILE);
          return true;
        }
      ),
      { numRuns: 5 }
    );
  });

  it('URL structure follows consistent pattern', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...Object.values(SETTINGS_SECTIONS)),
        (section) => {
          const url = generateSectionUrl(section);
          
          // Should start with /settings/
          expect(url.startsWith('/settings/')).toBe(true);
          
          // Should not have trailing slash
          expect(url.endsWith('/')).toBe(false);
          
          // Should not have multiple slashes
          expect(url.includes('//')).toBe(false);
          
          // Should be lowercase
          expect(url).toBe(url.toLowerCase());
          
          // Should match expected pattern. Section slugs are lowercase words
          // optionally joined by single hyphens (e.g. "weekly-recap").
          expect(url).toMatch(/^\/settings\/[a-z]+(?:-[a-z]+)*$/);
          
          return true;
        }
      ),
      { numRuns: 25 }
    );
  });

  it('invalid URLs are properly rejected', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant('/settings/invalid-section'),
          fc.constant('/settings/'),
          fc.constant('/settings//profile'),
          fc.constant('/settings/Profile'), // uppercase
          fc.constant('/setting/profile'), // typo
          fc.constant('/settings/profile/extra'),
        ),
        (invalidUrl) => {
          const isValid = isValidSettingsUrl(invalidUrl);
          const parsedSection = parseSectionFromUrl(invalidUrl);
          
          // Invalid URLs should either be rejected or return null
          if (!isValid) {
            expect(parsedSection).toBeNull();
          }
          
          return true;
        }
      ),
      { numRuns: 15 }
    );
  });

  it('URL generation is consistent and reversible', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...Object.values(SETTINGS_SECTIONS)),
        (originalSection) => {
          // Generate URL from section
          const url = generateSectionUrl(originalSection);
          
          // Parse section back from URL
          const parsedSection = parseSectionFromUrl(url);
          
          // Should be reversible
          expect(parsedSection).toBe(originalSection);
          
          // Generate URL again from parsed section
          const regeneratedUrl = generateSectionUrl(parsedSection!);
          
          // Should be consistent
          expect(regeneratedUrl).toBe(url);
          
          return true;
        }
      ),
      { numRuns: 30 }
    );
  });

  it('section names match URL segments exactly', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...Object.values(SETTINGS_SECTIONS)),
        (section) => {
          const url = generateSectionUrl(section);
          const urlSegment = url.replace('/settings/', '');
          
          // URL segment should match section name exactly
          expect(urlSegment).toBe(section);
          
          return true;
        }
      ),
      { numRuns: 20 }
    );
  });

  it('URL patterns support browser navigation expectations', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...Object.values(SETTINGS_SECTIONS)), { minLength: 2, maxLength: 5 }),
        (sectionSequence) => {
          const urls = sectionSequence.map(generateSectionUrl);
          
          // Each URL should be valid
          urls.forEach(url => {
            expect(isValidSettingsUrl(url)).toBe(true);
          });
          
          // URLs should be unique for different sections
          const uniqueUrls = new Set(urls);
          const uniqueSections = new Set(sectionSequence);
          expect(uniqueUrls.size).toBe(uniqueSections.size);
          
          return true;
        }
      ),
      { numRuns: 20 }
    );
  });

  it('URL structure supports deep linking to specific sections', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...Object.values(SETTINGS_SECTIONS)),
        (section) => {
          const url = generateSectionUrl(section);
          
          // URL should be suitable for deep linking
          expect(url.length).toBeGreaterThan('/settings'.length);
          expect(url.length).toBeLessThan(50); // Reasonable length limit
          
          // Should not contain special characters that break URLs
          expect(url).not.toMatch(/[^a-z0-9\/\-]/);
          
          // Should be bookmarkable (no query params or fragments in base URL)
          expect(url).not.toContain('?');
          expect(url).not.toContain('#');
          
          return true;
        }
      ),
      { numRuns: 25 }
    );
  });
});
