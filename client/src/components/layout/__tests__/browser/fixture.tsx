import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Router, useLocation } from 'wouter';
import { navigate } from 'wouter/use-browser-location';
import Layout from '@/components/Layout';
import { SettingsLayout } from '@/pages/settings/SettingsLayout';
import { SECTION_LABELS, type SettingsSection } from '@/features/settings/constants/sectionNames';
import { PreferenceFixture, useSettings } from './data.fixture';
import './fixture.css';

const parameters = new URLSearchParams(location.search);
let resolveDestination!: (value: { default: React.ComponentType }) => void;
const destination = new Promise<{ default: React.ComponentType }>(resolve => { resolveDestination = resolve; });
const DelayedDestination = React.lazy(() => destination);
declare global {
  interface Window { r18Fixture: { navigate: typeof navigate; resolveDestination: () => void }; }
}
window.r18Fixture = { navigate, resolveDestination: () => resolveDestination({
  default: () => <Layout><Content path="/accounts" intentionalFocus={parameters.get('focusChild') === '1'} /></Layout>,
}) };
let nextMount = 0;

function Content({ path, intentionalFocus = false }: { path: string; intentionalFocus?: boolean }) {
  const [mount] = useState(() => ++nextMount);
  const preference = useSettings();
  return <section data-fixture-route={path} data-fixture-mount={mount}>
    <output hidden data-fixture-preference data-collapsed={preference.sidebarCollapsed} data-toggle-count={preference.toggleCount} />
    <h1 className="break-words text-2xl font-semibold">{path} page</h1>
    <label className="mt-4 block">Main field<input className="mt-1 block w-full max-w-md rounded border p-2" /></label>
    <button className="mt-4 min-h-11 rounded border px-3" type="button" autoFocus={intentionalFocus}>Main action</button>
    <div className="h-[1200px]" aria-hidden="true" />
    <button className="min-h-11 rounded border px-3" type="button">Last main action</button>
  </section>;
}

function SettingsPage() {
  const [section, setSection] = useState<SettingsSection>('profile');
  return <SettingsLayout activeSection={section} onSectionChange={setSection}>
    <h1 className="break-words text-2xl font-semibold">{SECTION_LABELS[section]} settings form</h1>
    <Content path="/profile" />
  </SettingsLayout>;
}

function RoutePages({ path }: { path: string }) {
  // Actual route pages each own Layout. A route change must destroy the source
  // trigger, Sheet and main, exposing any destination focus restoration defect.
  if (path === '/accounts' && parameters.has('delayed')) return <DelayedDestination />;
  return path === '/profile' ? <SettingsPage key={path} /> : <Layout key={path}><Content path={path} /></Layout>;
}

function ApplicationRoutes() {
  // Mirror App.tsx's route subscription above its Suspense boundary. Without
  // this owner, a Back event equal to the inner committed snapshot can bail out.
  const [path] = useLocation();
  return <React.Suspense fallback={<p role="status">Loading destination</p>}>
    <RoutePages path={path} />
  </React.Suspense>;
}

createRoot(document.getElementById('root')!).render(
  <PreferenceFixture><Router>
    <ApplicationRoutes />
  </Router></PreferenceFixture>,
);
