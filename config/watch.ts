/**
 * Directories to exclude from Vite file watching.
 * These cover heavy/generated directories that would otherwise cause
 * massive file watcher pressure (75K+ files).
 */
export const WATCH_IGNORED = [
  '**/activity_log.json',
  '**/artifacts/**',
  '**/.agent/**',
  '**/storage/**',
  '**/templates/**',
  '**/ppomppu_profile/**',
  '**/data/**',
  '**/.venv/**',
  '**/dist/**',
  '**/node_modules/**',
  '**/.git/**',
  '**/kakaoauto-controller-preview/**',
  '**/mempalace*/**',
];
