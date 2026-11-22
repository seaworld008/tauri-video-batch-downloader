/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import tsconfigPaths from 'vite-tsconfig-paths';

const packageJson = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
) as { version: string };

// https://vitejs.dev/config/
// Note: canonical test configs live in vitest.config.ts and vitest.config.integration.ts.
// Keep the inline test block aligned enough for editor/tooling discovery, but do not treat
// this file as the source of truth for the project's test workflow.
export default defineConfig({
  plugins: [react(), tailwindcss(), tsconfigPaths()],

  // Vite options tailored for Tauri development
  clearScreen: false,

  server: {
    port: 1420,
    strictPort: true,
    host: process.env.TAURI_DEV_HOST || '127.0.0.1',
    hmr: {
      port: 1421,
    },
  },

  // Build options
  build: {
    sourcemap: process.env.TAURI_DEBUG === 'true',
    target: 'esnext',
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          return id.includes('node_modules') ? 'vendor' : undefined;
        },
      },
    },
  },

  // Environment variables
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? packageJson.version),
    __TAURI_DEBUG__: JSON.stringify(process.env.TAURI_DEBUG === 'true'),
  },

  // Test configuration (editor/tooling fallback only; see vitest.config*.ts for canonical configs)
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
  },

  // Optimize dependencies
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      '@headlessui/react',
      '@heroicons/react/24/outline',
      'zustand',
      'zod',
    ],
  },
});
