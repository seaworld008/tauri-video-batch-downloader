#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import WebSocket from 'ws';

const DEFAULT_URL = process.env.TAURI_MCP_WS ?? 'ws://127.0.0.1:9223';
const DEFAULT_SCREENSHOT = path.join(os.tmpdir(), 'video-downloader-pro-tauri-smoke.png');
const DEFAULT_TIMEOUT_MS = 15_000;

function parseArgs(argv) {
  const options = {
    url: DEFAULT_URL,
    screenshot: DEFAULT_SCREENSHOT,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    skipScreenshot: false,
    expectedIdentifier: 'com.videodownloader.pro',
    expectedName: 'Video Downloader Pro',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--url') {
      options.url = readRequiredOption(argv, index, '--url');
      index += 1;
    } else if (arg === '--screenshot') {
      options.screenshot = readRequiredOption(argv, index, '--screenshot');
      index += 1;
    } else if (arg === '--timeout-ms') {
      options.timeoutMs = Number(readRequiredOption(argv, index, '--timeout-ms'));
      index += 1;
    } else if (arg === '--skip-screenshot') {
      options.skipScreenshot = true;
    } else if (arg === '--expected-identifier') {
      options.expectedIdentifier = readRequiredOption(argv, index, '--expected-identifier');
      index += 1;
    } else if (arg === '--expected-name') {
      options.expectedName = readRequiredOption(argv, index, '--expected-name');
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error('--timeout-ms must be a positive number');
  }

  return options;
}

function readRequiredOption(argv, index, name) {
  const value = argv[index + 1];
  if (!value) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function printHelp() {
  console.log(`Usage: pnpm test:tauri-smoke [options]

Requires a real Tauri dev app with tauri-plugin-mcp-bridge already running.
Start it in another terminal with:
  pnpm tauri dev

Options:
  --url <ws-url>                 MCP Bridge WebSocket URL. Default: ${DEFAULT_URL}
  --screenshot <path>            Where to write the native screenshot.
  --skip-screenshot              Check backend/window state only.
  --timeout-ms <ms>              Command timeout. Default: ${DEFAULT_TIMEOUT_MS}
  --expected-identifier <id>     Expected Tauri app identifier.
  --expected-name <name>         Expected Tauri app name.
`);
}

function connect(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`Timed out connecting to MCP Bridge at ${url}`));
    }, timeoutMs);

    socket.once('open', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function createMcpClient(socket, timeoutMs) {
  let nextId = 1;
  const pending = new Map();

  socket.on('message', raw => {
    const message = JSON.parse(raw.toString());
    const request = pending.get(message.id);
    if (!request) {
      return;
    }

    clearTimeout(request.timer);
    pending.delete(message.id);
    if (message.success) {
      request.resolve(message);
    } else {
      request.reject(new Error(message.error ?? `MCP command failed: ${message.id}`));
    }
  });

  return {
    command(command, args = {}) {
      const id = `smoke-${nextId}`;
      nextId += 1;
      const payload = JSON.stringify({ id, command, args });

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Timed out waiting for MCP command: ${command}`));
        }, timeoutMs);

        pending.set(id, { resolve, reject, timer });
        socket.send(payload);
      });
    },
    close() {
      socket.close();
    },
  };
}

function assertBackendState(state, options) {
  if (state.app?.identifier !== options.expectedIdentifier) {
    throw new Error(`Unexpected app identifier: ${state.app?.identifier}`);
  }
  if (state.app?.name !== options.expectedName) {
    throw new Error(`Unexpected app name: ${state.app?.name}`);
  }
  if (!Number.isInteger(state.window_count) || state.window_count < 1) {
    throw new Error(`Expected at least one Tauri window, got ${state.window_count}`);
  }

  const mainWindow = state.windows?.find(window => window.label === 'main');
  if (!mainWindow) {
    throw new Error('Expected main Tauri window to be registered');
  }
  if (!mainWindow.visible) {
    throw new Error('Expected main Tauri window to be visible');
  }
}

function writeScreenshot(dataUrl, screenshotPath) {
  const match = /^data:image\/png;base64,(.+)$/u.exec(dataUrl);
  if (!match) {
    throw new Error('MCP screenshot did not return a PNG data URL');
  }

  const bytes = Buffer.from(match[1], 'base64');
  if (bytes.length < 1024) {
    throw new Error(`MCP screenshot looks too small (${bytes.length} bytes)`);
  }

  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  fs.writeFileSync(screenshotPath, bytes);
  return bytes.length;
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const socket = await connect(options.url, options.timeoutMs);
  const client = createMcpClient(socket, options.timeoutMs);

  try {
    const backend = await client.command('invoke_tauri', {
      command: 'plugin:mcp-bridge|get_backend_state',
      args: {},
    });
    assertBackendState(backend.data, options);

    const windows = await client.command('list_windows');
    if (!Array.isArray(windows.data) || windows.data.length < 1) {
      throw new Error('MCP list_windows returned no windows');
    }

    let screenshotBytes = 0;
    if (!options.skipScreenshot) {
      const screenshot = await client.command('capture_native_screenshot', {
        windowLabel: 'main',
        format: 'png',
        maxWidth: 1200,
      });
      screenshotBytes = writeScreenshot(screenshot.data, options.screenshot);
    }

    console.log('Tauri MCP smoke passed');
    console.log(`- app: ${backend.data.app.name} (${backend.data.app.identifier})`);
    console.log(`- tauri: ${backend.data.tauri.version}`);
    console.log(`- windows: ${backend.data.window_count}`);
    if (!options.skipScreenshot) {
      console.log(`- screenshot: ${options.screenshot} (${screenshotBytes} bytes)`);
    }
  } finally {
    client.close();
  }
}

run().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
