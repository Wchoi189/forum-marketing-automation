import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

// Directories to exclude from Vite file watching. These cover heavy/generated
// directories that would otherwise cause massive file watcher pressure (75K+ files).
const WATCH_IGNORED = [
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

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: {
        // Exclude heavy/generated directories so Vite's file watcher doesn't
        // index 75K+ files (Chromium profiles, build output, AI tool caches).
        ignored: WATCH_IGNORED,
      },
    },
  };
});
