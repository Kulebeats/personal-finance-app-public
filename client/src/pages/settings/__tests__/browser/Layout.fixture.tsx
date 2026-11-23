import React from 'react';

/** Inert outer shell: one real main landmark, no app/auth/query/session imports. */
export default function LayoutFixture({ children }: { children: React.ReactNode }) {
  return <div className="flex h-dvh min-w-0 flex-col bg-background text-foreground">
    <header data-fixture-header className="shrink-0 border-b px-4 py-3">
      <button type="button" className="min-h-11 rounded border px-3">Application navigation</button>
    </header>
    <main id="main-content" className="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <div className="min-h-full">{children}</div>
    </main>
  </div>;
}
