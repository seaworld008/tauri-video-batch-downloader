/**
 * Vitest configuration for integration tests
 * Includes setup for both frontend integration and E2E tests
 */

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],

  test: {
    // 集成测试环境配置
    environment: 'jsdom',

    // 测试文件匹配模式
    include: ['src/**/*.integration.test.{ts,tsx}', 'src/**/*.e2e.test.{ts,tsx}'],

    // 排除的文件
    exclude: ['node_modules/**', 'dist/**', 'src-tauri/**'],

    // 全局设置文件
    setupFiles: ['./src/__tests__/setup/integration.setup.ts'],

    // 测试超时配置
    testTimeout: 30000, // 30秒，适合集成测试
    hookTimeout: 10000, // 钩子超时

    // 覆盖率配置
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src-tauri/',
        'src/__tests__/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/coverage/**',
      ],
      // 集成测试覆盖率阈值
      thresholds: {
        functions: 60,
        lines: 60,
        statements: 60,
        branches: 50,
      },
    },

    // 并发配置
    pool: 'threads',
    maxWorkers: 1, // 集成/E2E测试串行执行，避免并发互相影响

    // 全局变量
    globals: true,

    // 环境变量
    env: {
      NODE_ENV: 'test',
      VITE_TAURI_TESTING: 'true',
    },
  },

  // Resolve aliases
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@tests': path.resolve(__dirname, './src/__tests__'),
    },
  },

  // Vite specific config for testing
  define: {
    global: 'globalThis',
  },
});
