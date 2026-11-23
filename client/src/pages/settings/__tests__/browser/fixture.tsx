import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import './fixture.css';
import { SettingsLayout } from '../../SettingsLayout';
import { SECTION_LABELS, type SettingsSection } from '@/features/settings/constants/sectionNames';

function Fixture() {
  const [active, setActive] = useState<SettingsSection>('profile');
  return <SettingsLayout activeSection={active} onSectionChange={setActive}>
    <h1 className="break-words text-2xl font-semibold">{SECTION_LABELS[active]} settings form</h1>
    <p className="mt-3 break-words">Isolated navigation and focus fixture. No application session or data backend.</p>
    <label className="mt-4 block">Example field<input className="mt-1 block w-full max-w-md rounded border p-2" /></label>
    <button type="button" className="mt-4 min-h-11 rounded border px-3">Save details</button>
  </SettingsLayout>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
