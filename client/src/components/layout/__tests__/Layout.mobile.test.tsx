import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router, useLocation } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';

// Keep the real Layout, TopBar, Sidebar, Sheet and router. Only effectful app
// boundaries are inert; this suite cannot fetch, authenticate or mutate settings.
vi.mock('@/hooks/use-settings', () => ({
  useProfile: () => ({ data: { id: 'fixture-user', fullName: 'Ada Lovelace' } }),
  useHouseholdMembers: () => ({ data: [] }),
  getInitials: () => 'AL',
}));
vi.mock('@/hooks/useAccounts', () => ({ useAccounts: () => ({ data: [] }) }));
const preference = vi.hoisted(() => ({ collapsed: false, toggle: vi.fn() }));
vi.mock('@/contexts/SettingsContext', () => ({ useSettings: () => ({ sidebarCollapsed: preference.collapsed, toggleSidebar: preference.toggle }) }));
vi.mock('@/contexts/CommandPaletteContext', () => ({ useCommandPalette: () => ({ toggle: vi.fn() }) }));
vi.mock('@/features/goals/components/GoalMilestoneModal', () => ({ GoalMilestoneModal: () => null }));
vi.mock('@/components/NotificationBell', () => ({ NotificationBell: () => null }));
vi.mock('@/components/ThemeToggle', () => ({ ThemeToggle: () => null }));
vi.mock('@/components/layout/ProfileMenu', () => ({ ProfileMenu: () => null }));

import Layout from '@/components/Layout';
import { NAV_GROUPS } from '@/components/layout/constants';

let desktop = false;
const listeners = new Set<() => void>();
type MediaQueryListener = ((this: MediaQueryList, event: MediaQueryListEvent) => void) | EventListenerObject;
beforeEach(() => {
  preference.collapsed = false;
  preference.toggle.mockClear();
  desktop = false;
  listeners.clear();
  vi.spyOn(window, 'matchMedia').mockImplementation(query => {
    const wrappers = new Map<MediaQueryListener, () => void>();
    const mediaQueryList: MediaQueryList = {
      get matches() { return query === '(min-width: 768px)' && desktop; },
      media: query, onchange: null,
      addEventListener(_type: string, listener: MediaQueryListener): void {
        if (wrappers.has(listener)) return;
        const notify = () => {
          const event: MediaQueryListEvent = Object.assign(new Event('change'), {
            matches: mediaQueryList.matches, media: query,
          });
          if (typeof listener === 'function') listener.call(mediaQueryList, event);
          else listener.handleEvent(event);
        };
        wrappers.set(listener, notify);
        listeners.add(notify);
      },
      removeEventListener(_type: string, listener: MediaQueryListener): void {
        const notify = wrappers.get(listener);
        if (notify) listeners.delete(notify);
        wrappers.delete(listener);
      },
      addListener() {}, removeListener() {}, dispatchEvent: () => true,
    };
    return mediaQueryList;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function setDesktop(value: boolean) {
  desktop = value;
  Array.from(listeners).forEach(listener => listener());
}

function Page({ remount }: { remount: boolean }) {
  const [path] = useLocation();
  return <Layout key={remount ? path : 'persistent-shell'}>
    <h1>{path} page</h1><button type="button">Main action</button>
  </Layout>;
}

function renderShell({ remount = false, path = '/transactions' } = {}) {
  const location = memoryLocation({ path });
  render(<Router hook={location.hook}><Page remount={remount} /></Router>);
  return location;
}

const trigger = () => screen.getByRole('button', { name: 'Open application navigation' });
const dialog = () => screen.getByRole('dialog', { name: 'Application navigation' });
const activeDesktopLink = (name = 'Transactions') => within(screen.getByRole('navigation', { name: 'Application navigation' })).getByRole('link', { name });
async function expectClosed() {
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
}

function renderDelayedShell(intentionalFocus = false, browserRouter = false) {
  let resolveDestination!: (value: { default: React.ComponentType }) => void;
  const destination = new Promise<{ default: React.ComponentType }>(resolve => { resolveDestination = resolve; });
  const LazyDestination = React.lazy(() => destination);
  function DelayedRoutes({ path }: { path: string }) {
    return path === '/accounts' ? <LazyDestination /> : <Page remount />;
  }
  function ApplicationRoutes() {
    // Actual App.tsx subscribes above Suspense for its session/public-route branch.
    // That owner must render Back even when the inner route never committed.
    const [path] = useLocation();
    return <React.Suspense fallback={<p role="status">Loading destination</p>}>
      <DelayedRoutes path={path} />
    </React.Suspense>;
  }
  const location = memoryLocation({ path: '/transactions' });
  if (browserRouter) window.history.replaceState(null, '', '/transactions');
  render(<Router {...(browserRouter ? {} : { hook: location.hook })}><ApplicationRoutes /></Router>);
  return async () => act(async () => {
    resolveDestination({ default: () => <Layout><h1>Delayed accounts page</h1>
      <button type="button" autoFocus={intentionalFocus}>Destination action</button>
    </Layout> });
    await destination;
  });
}

describe('actual application mobile navigation', () => {
  it('offers a keyboard-operable application drawer while the desktop preference is expanded', async () => {
    const user = userEvent.setup();
    const location = memoryLocation({ path: '/transactions' });
    render(<Router hook={location.hook}><Layout><h1>Transactions page</h1></Layout></Router>);

    const trigger = screen.getByRole('button', { name: 'Open application navigation' });
    trigger.focus();
    await user.keyboard('{Enter}');

    const dialog = screen.getByRole('dialog', { name: 'Application navigation' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(within(dialog).queryByRole('button', { name: /collapse|expand sidebar/i })).not.toBeInTheDocument();
    for (const item of NAV_GROUPS.flatMap(group => group.items)) {
      expect(within(dialog).getByRole('link', { name: item.label })).toHaveAttribute('href', item.href);
    }
    expect(within(dialog).getByRole('link', { name: 'Transactions' })).toHaveAttribute('aria-current', 'page');
    expect(within(dialog).getByRole('link', { name: 'Profile: Ada Lovelace' })).toHaveAttribute('href', '/profile');
  });

  it('contains forward and reverse Tab navigation and restores the trigger on Escape', async () => {
    const user = userEvent.setup(); renderShell();
    trigger().focus(); await user.keyboard(' ');
    const modal = dialog(), close = within(modal).getByRole('button', { name: /^Close$/ });
    close.focus();
    await user.tab({ shift: true });
    expect(within(modal).getByRole('link', { name: 'Profile: Ada Lovelace' })).toHaveFocus();
    await user.tab(); expect(close).toHaveFocus();
    await user.tab(); expect(within(modal).getByRole('link', { name: 'Dashboard' })).toHaveFocus();
    await user.keyboard('{Escape}'); await expectClosed();
    await waitFor(() => expect(trigger()).toHaveFocus());
    expect(preference.toggle).not.toHaveBeenCalled();
  });

  it('restores the trigger after using the explicit Close control', async () => {
    const user = userEvent.setup(); renderShell();
    await user.click(trigger());
    await user.click(within(dialog()).getByRole('button', { name: /^Close$/ }));
    await expectClosed();
    await waitFor(() => expect(trigger()).toHaveFocus());
  });

  it('closes on keyboard activation of the current route without changing desktop preference', async () => {
    preference.collapsed = true;
    const user = userEvent.setup(); renderShell({ remount: true });
    await user.click(trigger());
    const current = within(dialog()).getByRole('link', { name: 'Transactions' });
    current.focus(); await user.keyboard('{Enter}'); await expectClosed();
    await waitFor(() => expect(trigger()).toHaveFocus());
    expect(preference.collapsed).toBe(true);
    expect(preference.toggle).not.toHaveBeenCalled();
  });

  it('focuses destination main after a cross-route selection remounts the whole Layout', async () => {
    const user = userEvent.setup(); renderShell({ remount: true });
    const previousMain = screen.getByRole('main');
    await user.click(trigger());
    await user.click(within(dialog()).getByRole('link', { name: 'Accounts' }));
    await expectClosed();
    expect(screen.getByRole('heading', { name: '/accounts page' })).toBeInTheDocument();
    expect(screen.getByRole('main')).not.toBe(previousMain);
    await waitFor(() => expect(screen.getByRole('main')).toHaveFocus());
    expect(preference.toggle).not.toHaveBeenCalled();
  });

  it('releases the source modal and exposes a delayed lazy loading status before resolution', async () => {
    const user = userEvent.setup(); renderDelayedShell();
    await user.click(trigger());
    await user.click(within(dialog()).getByRole('link', { name: 'Accounts' }));
    const loading = screen.getByRole('status', { hidden: true });
    await expectClosed();
    expect(screen.getByRole('status')).toBe(loading);
    expect(loading.closest('[aria-hidden="true"]')).toBeNull();
    await waitFor(() => expect(document.body.style.pointerEvents).not.toBe('none'));
    await waitFor(() => expect(document.body).not.toHaveAttribute('data-scroll-locked'));
  });

  it.each([false, true])('handles a delayed lazy destination (intentional child focus: %s)', async intentionalFocus => {
    const user = userEvent.setup();
    const resolveDestination = renderDelayedShell(intentionalFocus);
    await user.click(trigger());
    await user.click(within(dialog()).getByRole('link', { name: 'Accounts' }));
    expect(screen.getByRole('status', { hidden: true })).toHaveTextContent('Loading destination');
    // Keep the lazy route unresolved across the source's deferred cleanup turn.
    // The destination main does not exist yet; a one-shot document lookup loses it.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
    expect(screen.queryByRole('main')).not.toBeInTheDocument();
    await resolveDestination();
    await expectClosed();
    await screen.findByRole('heading', { name: 'Delayed accounts page' });
    await waitFor(() => expect(intentionalFocus
      ? screen.getByRole('button', { name: 'Destination action' })
      : screen.getByRole('main')).toHaveFocus());
  });

  it('closes external browser navigation before a delayed lazy route suspends', async () => {
    const user = userEvent.setup();
    const resolveDestination = renderDelayedShell(false, true);
    await user.click(trigger());
    act(() => window.history.pushState(null, '', '/accounts'));
    expect(screen.getByRole('status', { hidden: true })).toHaveTextContent('Loading destination');
    await expectClosed();
    expect(screen.getByRole('status')).toHaveTextContent('Loading destination');
    await waitFor(() => expect(document.body).not.toHaveAttribute('data-scroll-locked'));
    await resolveDestination();
    await waitFor(() => expect(screen.getByRole('main')).toHaveFocus());
  });

  it('cancels a delayed destination handoff after browser Back and preserves current main focus', async () => {
    const user = userEvent.setup();
    const resolveDestination = renderDelayedShell(false, true);
    await user.click(trigger());
    await user.click(within(dialog()).getByRole('link', { name: 'Accounts' }));
    await expectClosed();
    expect(screen.getByRole('status')).toHaveTextContent('Loading destination');
    act(() => window.history.back());
    await waitFor(() => expect(window.location.pathname).toBe('/transactions'));
    await screen.findByRole('heading', { name: '/transactions page' });
    const action = screen.getByRole('button', { name: 'Main action' });
    action.focus();
    await resolveDestination();
    expect(action).toHaveFocus();
    expect(screen.getByRole('main')).not.toHaveFocus();
    expect(window.location.pathname).toBe('/transactions');
  });

  it('closes an open drawer when the router changes independently of its links', async () => {
    const user = userEvent.setup(); const location = renderShell();
    await user.click(trigger());
    act(() => location.navigate('/goals')); await expectClosed();
    expect(screen.getByRole('heading', { name: '/goals page' })).toBeInTheDocument();
  });

  it('closes at desktop and focuses the active native desktop link', async () => {
    const user = userEvent.setup(); renderShell(); await user.click(trigger());
    act(() => setDesktop(true)); await expectClosed();
    await waitFor(() => expect(activeDesktopLink()).toHaveFocus());
    expect(preference.toggle).not.toHaveBeenCalled();
  });

  it('rechecks the current breakpoint when an open drawer reverses to mobile during closure', async () => {
    const user = userEvent.setup(); renderShell(); await user.click(trigger());
    act(() => { setDesktop(true); setDesktop(false); }); await expectClosed();
    await waitFor(() => expect(trigger()).toHaveFocus());
  });

  it('moves closed rail and trigger focus when their controls become hidden', async () => {
    desktop = true; renderShell();
    activeDesktopLink().focus();
    act(() => setDesktop(false));
    await waitFor(() => expect(trigger()).toHaveFocus());
    act(() => setDesktop(true));
    await waitFor(() => expect(activeDesktopLink()).toHaveFocus());
  });

  it.each([
    ['Control', { ctrlKey: true }], ['Meta', { metaKey: true }],
    ['Shift', { shiftKey: true }], ['Alt', { altKey: true }],
    ['middle button', { button: 1 }],
  ] as const)('preserves the current drawer and route on %s link activation', async (_name, modifiers) => {
    const user = userEvent.setup(); renderShell();
    await user.click(trigger());
    const modal = dialog();
    const accounts = within(modal).getByRole('link', { name: 'Accounts' });
    // Cancel only browser-default navigation after React/Wouter handled the link.
    // jsdom cannot open the new browsing context that a modified link can request.
    const cancelDefault = (event: MouseEvent) => event.preventDefault();
    document.addEventListener('click', cancelDefault);
    try { fireEvent.click(accounts, modifiers); }
    finally { document.removeEventListener('click', cancelDefault); }
    expect(dialog()).toBe(modal);
    expect(screen.getByRole('heading', { name: '/transactions page', hidden: true })).toBeInTheDocument();
    expect(preference.toggle).not.toHaveBeenCalled();
  });

  it('preserves focus already in main content during breakpoint changes and unrelated remounts', async () => {
    const location = renderShell({ remount: true });
    const mainAction = screen.getByRole('button', { name: 'Main action' });
    mainAction.focus();
    act(() => setDesktop(true)); expect(mainAction).toHaveFocus();
    act(() => setDesktop(false)); expect(mainAction).toHaveFocus();
    act(() => location.navigate('/accounts'));
    expect(screen.getByRole('main')).not.toHaveFocus();
  });
});
