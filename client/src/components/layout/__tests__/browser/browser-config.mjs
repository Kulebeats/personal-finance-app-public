import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export function componentServerConfig(root, fixtureRoot) {
  const inert = path.join(fixtureRoot, 'data.fixture.tsx');
  const boundaries = ['@/hooks/use-settings', '@/hooks/useAccounts', '@/hooks/useNotifications',
    '@/contexts/SettingsContext', '@/contexts/CommandPaletteContext', '@/lib/api', '@/lib/protected-media',
    '@/features/goals/components/GoalMilestoneModal'];
  return { configFile: false, envFile: false, root: fixtureRoot, publicDir: false,
    plugins: [react(), tailwindcss()], logLevel: 'error',
    resolve: { alias: [
      ...boundaries.map(find => ({ find, replacement: inert })),
      { find: '@', replacement: path.join(root, 'client/src') },
      { find: '@assets', replacement: path.join(root, 'attached_assets') },
      { find: '@shared', replacement: path.join(root, 'shared') },
    ] },
    server: { host: '127.0.0.1', port: 0, hmr: false,
      fs: { strict: true, allow: [root], deny: ['**/.env*', '**/.git/**'] } },
  };
}
