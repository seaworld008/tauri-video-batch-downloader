/// <reference types="vitest/globals" />
/// <reference types="vite/client" />

import 'vitest/globals'

// Extend global vitest types
declare global {
  // Make vitest globals available
  const vi: typeof import('vitest').vi
  const describe: typeof import('vitest').describe
  const it: typeof import('vitest').it
  const test: typeof import('vitest').test
  const expect: typeof import('vitest').expect
  const beforeAll: typeof import('vitest').beforeAll
  const afterAll: typeof import('vitest').afterAll
  const beforeEach: typeof import('vitest').beforeEach
  const afterEach: typeof import('vitest').afterEach

  interface ImportMetaEnv {
    readonly VITE_APP_TITLE: string
    readonly VITE_TAURI_TESTING?: string
    readonly NODE_ENV: string
    readonly MODE: string
    readonly DEV: boolean
    readonly PROD: boolean
    readonly SSR: boolean
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv
  }
}

export {}