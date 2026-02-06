import '@testing-library/jest-dom';

// Mock Tauri APIs that are used in the application
vi.mock('@tauri-apps/api/tauri', async () => {
  const actual =
    await vi.importActual<typeof import('@tauri-apps/api/tauri')>('@tauri-apps/api/tauri');
  return {
    ...actual,
    invoke: vi.fn((cmd: string, args?: Record<string, unknown>) => {
      if (typeof window !== 'undefined' && typeof window.__TAURI_IPC__ === 'function') {
        return actual.invoke(cmd, args);
      }
      return Promise.resolve({});
    }),
  };
});

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue({}),
}));

vi.mock('@tauri-apps/api/fs', () => ({
  readTextFile: vi.fn().mockResolvedValue(''),
  writeTextFile: vi.fn().mockResolvedValue({}),
  exists: vi.fn().mockResolvedValue(true),
  createDir: vi.fn().mockResolvedValue({}),
}));

vi.mock('@tauri-apps/api/path', () => ({
  join: vi.fn().mockResolvedValue(''),
  appDataDir: vi.fn().mockResolvedValue('/app-data'),
  downloadDir: vi.fn().mockResolvedValue('/downloads'),
}));

vi.mock('@tauri-apps/api/dialog', () => ({
  open: vi.fn().mockResolvedValue(''),
  save: vi.fn().mockResolvedValue(''),
  message: vi.fn().mockResolvedValue({}),
  confirm: vi.fn().mockResolvedValue(true),
}));

// Mock window.matchMedia for responsive design tests
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // Deprecated
    removeListener: vi.fn(), // Deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock IntersectionObserver
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

const originalError = console.error;
const originalWarn = console.warn;
const originalLog = console.log;
const showTestLogs = typeof process !== 'undefined' && process.env.VITEST_SHOW_LOGS === 'true';

// Suppress noisy console output during tests unless explicitly enabled
beforeAll(() => {
  if (!showTestLogs) {
    console.log = () => {};
    console.warn = () => {};
    console.error = () => {};
    return;
  }

  console.error = (...args: any[]) => {
    if (
      typeof args[0] === 'string' &&
      (args[0].includes('Warning:') ||
        args[0].includes('validateDOMNesting') ||
        args[0].includes('React does not recognize'))
    ) {
      return;
    }
    originalError.call(console, ...args);
  };
});

afterAll(() => {
  console.error = originalError;
  console.warn = originalWarn;
  console.log = originalLog;
});
