import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import {visualizer} from 'rollup-plugin-visualizer';
import {WATCH_IGNORED} from './config/watch.js';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [
      react(),
      tailwindcss(),
      visualizer({
        template: 'treemap',
        gzipSize: true,
        brotliSize: false,
        filename: 'dist/stats.html',
        open: false,
      }),
    ],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),

      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-recharts': ['recharts'],
            'vendor-motion': ['motion'],
            'vendor-lucide': ['lucide-react'],
            // @xyflow/react (ReactFlow) — only used on /operations route.
            // Paired with React.lazy on OperationsPage.
            'vendor-xyflow': ['@xyflow/react'],
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: {
        // Exclude heavy/generated directories so Vite's file watcher doesn't
        // index 75K+ files (Chromium profiles, build output, AI tool caches).
        ignored: WATCH_IGNORED,
      },
    },
  };
});
