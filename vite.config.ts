/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import tsconfigPaths from 'vite-tsconfig-paths';

// https://vitejs.dev/config/
// Note: canonical test configs live in vitest.config.ts and vitest.config.integration.ts.
// Keep the inline test block aligned enough for editor/tooling discovery, but do not treat
// this file as the source of truth for the project's test workflow.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    tsconfigPaths()
  ],

  // Vite options tailored for Tauri development
  clearScreen: false,

  server: {
    port: 1420,
    strictPort: true,
    host: '0.0.0.0',
    hmr: {
      port: 1421,
    },
  },

  // Build options
  build: {
    sourcemap: true,
    target: 'esnext',
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    rollupOptions: {
      external: ['@tauri-apps/api'],
    },
  },

  // Environment variables
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version),
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
      '@heroicons/react/24/solid',
      'zustand',
      '@tanstack/react-query',
      'react-hook-form',
      'zod',
      'date-fns',
      'clsx',
    ],
  },
});
