/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import tsconfigPaths from 'vite-tsconfig-paths';

// https://vitejs.dev/config/
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

  // Test configuration
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
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
