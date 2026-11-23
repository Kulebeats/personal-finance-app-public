import React, { createContext, useContext, useState } from 'react';

// Effectful boundaries only: the shell, TopBar controls, Sidebar, router, both
// Sheets and SettingsLayout are real. No session, query client or backend exists.
const profile = { id: 'fixture-user', fullName: 'Ada Lovelace', email: 'ada@example.invalid', profilePictureUrl: null };
const members = [{ userId: 'fixture-user', name: 'Ada Lovelace' }, { userId: 'fixture-partner', name: 'Fixture Partner' }];
const empty: never[] = [];
export const useProfile = () => ({ data: profile });
export const useHouseholdMembers = () => ({ data: members });
export const useAccounts = () => ({ data: empty });
export const getInitials = (name?: string | null) => name?.split(' ').map(value => value[0]).join('').slice(0, 2) || 'U';
const forbiddenMutation = () => { throw new Error('Component fixture has no mutation or authentication backend'); };
export const authApi = { logout: forbiddenMutation };
export const useNotifications = () => ({ data: empty, isLoading: false, error: null, refetch: forbiddenMutation });
export const useUnreadCount = () => ({ data: 0 });
export const useMarkAsRead = () => ({ mutate: forbiddenMutation, isPending: false });
export const useMarkAllAsRead = useMarkAsRead;
export const isProtectedMediaSource = () => false;
export const useProtectedObjectUrl = () => ({ url: null, error: null });
export const GoalMilestoneModal = () => null;
export const useCommandPalette = () => ({ toggle: () => {} });

const Preference = createContext({ sidebarCollapsed: false, toggleSidebar: () => {}, toggleCount: 0 });
export const useSettings = () => useContext(Preference);
export function PreferenceFixture({ children }: { children: React.ReactNode }) {
  const [sidebarCollapsed, setCollapsed] = useState(new URLSearchParams(location.search).get('collapsed') === '1');
  const [toggleCount, setToggleCount] = useState(0);
  return <Preference.Provider value={{ sidebarCollapsed, toggleCount, toggleSidebar: () => {
    setCollapsed(value => !value); setToggleCount(value => value + 1);
  } }}>{children}</Preference.Provider>;
}
