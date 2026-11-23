import React, { useState } from 'react';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_SECTIONS, SECTION_LABELS, type SettingsSection } from '@/features/settings/constants/sectionNames';

// Only the effectful app shell/data boundary is inert. Sheet, portal, focus scope,
// dismissal and the settings navigation under test are the actual components.
vi.mock('@/components/Layout', () => ({ default: ({ children }: { children: React.ReactNode }) => (
  <main><header><button type="button">Application navigation</button></header>{children}</main>
) }));
vi.mock('@/lib/api', () => ({ authApi: { logout: vi.fn() } }));
import { SettingsLayout } from '../SettingsLayout';

function Harness({ onChange = () => {} }: { onChange?: (section: SettingsSection) => void }) {
  const [active, setActive] = useState<SettingsSection>(SETTINGS_SECTIONS.PROFILE);
  return <SettingsLayout activeSection={active} onSectionChange={section => { onChange(section); setActive(section); }}>
    <h1>{SECTION_LABELS[active]} settings form</h1><button type="button">Save details</button>
  </SettingsLayout>;
}
const trigger = () => screen.getByRole('button', { name: /settings menu/i });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('actual settings mobile Sheet', () => {
  it('uses the outer main landmark once', () => {
    render(<Harness />);
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });
  it('opens a named, described modal with every settings section and Logout', async () => {
    const user = userEvent.setup(); render(<Harness />);
    await user.click(trigger());
    const dialog = screen.getByRole('dialog', { name: 'Settings navigation' });
    expect(dialog).toHaveAccessibleDescription('Choose a section to manage your settings.');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    for (const section of Object.values(SETTINGS_SECTIONS)) {
      expect(within(dialog).getByRole('button', { name: `Navigate to ${SECTION_LABELS[section]} settings` })).toBeEnabled();
    }
    expect(within(dialog).getByRole('button', { name: 'Logout' })).toBeEnabled();
  });
  it('closes on every section activation, preserves the callback and restores usable focus', async () => {
    const user = userEvent.setup(), onChange = vi.fn(); render(<Harness onChange={onChange} />);
    for (const section of Object.values(SETTINGS_SECTIONS)) {
      await user.click(trigger());
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: `Navigate to ${SECTION_LABELS[section]} settings` }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(onChange).toHaveBeenLastCalledWith(section);
      expect(screen.getByRole('heading', { name: `${SECTION_LABELS[section]} settings form` })).toBeVisible();
      await waitFor(() => expect(trigger()).toHaveFocus());
    }
    expect(onChange).toHaveBeenCalledTimes(Object.values(SETTINGS_SECTIONS).length);
    await user.click(trigger());
    const active = within(screen.getByRole('dialog')).getAllByRole('button').filter(button => button.getAttribute('aria-current') === 'page');
    expect(active).toHaveLength(1); expect(active[0]).toHaveAccessibleName('Navigate to Weekly Recap settings');
  });
  it('traps keyboard focus and closes with Escape, restoring the trigger', async () => {
    const user = userEvent.setup(); render(<Harness />);
    trigger().focus(); await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog'), close = within(dialog).getByRole('button', { name: /^Close$/ });
    close.focus();
    await user.tab({ shift: true }); expect(within(dialog).getByRole('button', { name: 'Logout' })).toHaveFocus();
    await user.tab(); expect(close).toHaveFocus();
    await user.tab(); expect(within(dialog).getByRole('button', { name: 'Navigate to Profile settings' })).toHaveFocus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger()).toHaveFocus());
  });
  it('supports keyboard selection and the explicit close control', async () => {
    const user = userEvent.setup(), onChange = vi.fn(); render(<Harness onChange={onChange} />);
    await user.click(trigger());
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Navigate to Security settings' }).focus();
    await user.keyboard(' ');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onChange).toHaveBeenCalledExactlyOnceWith(SETTINGS_SECTIONS.SECURITY);
    await user.click(trigger()); await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Close$/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger()).toHaveFocus());
  });
  it('closes on the desktop breakpoint and focuses the visible active desktop section', async () => {
    let desktop = false;
    const listeners = new Set<() => void>();
    const media = { get matches() { return desktop; }, media: '(min-width: 768px)', onchange: null,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
      addListener() {}, removeListener() {}, dispatchEvent: () => true };
    vi.spyOn(window, 'matchMedia').mockReturnValue(media as unknown as MediaQueryList);
    const user = userEvent.setup(); render(<Harness />); await user.click(trigger());
    act(() => { desktop = true; Array.from(listeners).forEach(listener => listener()); });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const navigation = screen.getByRole('navigation', { name: 'Settings navigation' });
    await waitFor(() => expect(within(navigation).getByRole('button', { name: 'Navigate to Profile settings' })).toHaveFocus());
  });
});
