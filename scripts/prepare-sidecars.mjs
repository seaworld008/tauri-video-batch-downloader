#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_BINARIES_DIR = 'src-tauri/binaries';
const DEFAULT_TIMEOUT_MS = 120_000;
const USER_AGENT = 'VideoDownloaderPro/1.0 sidecar-preparer';

function parseArgs(argv) {
  const options = {
    target: detectCurrentTarget(),
    binariesDir: DEFAULT_BINARIES_DIR,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    skipYtdlp: false,
    skipFfmpeg: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--target') {
      options.target = readRequiredOption(argv, index, '--target');
      index += 1;
    } else if (arg === '--binaries-dir') {
      options.binariesDir = readRequiredOption(argv, index, '--binaries-dir');
      index += 1;
    } else if (arg === '--timeout-ms') {
      options.timeoutMs = Number(readRequiredOption(argv, index, '--timeout-ms'));
      index += 1;
    } else if (arg === '--skip-ytdlp') {
      options.skipYtdlp = true;
    } else if (arg === '--skip-ffmpeg') {
      options.skipFfmpeg = true;
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
  console.log(`Usage: pnpm sidecars:prepare [options]

Downloads or copies real sidecar binaries into src-tauri/binaries for Tauri externalBin.

Options:
  --target <triple>        Rust target triple. Default: current host target.
  --binaries-dir <path>    Sidecar directory. Default: ${DEFAULT_BINARIES_DIR}
  --timeout-ms <ms>        Download timeout. Default: ${DEFAULT_TIMEOUT_MS}
  --skip-ytdlp             Do not prepare yt-dlp.
  --skip-ffmpeg            Do not prepare ffmpeg.

Environment:
  VDP_YTDLP_BINARY         Copy this trusted yt-dlp binary instead of downloading latest release.
  VDP_FFMPEG_BINARY        Copy this trusted ffmpeg binary instead of using ffmpeg-static.
`);
}

function detectCurrentTarget() {
  const arch = process.arch;
  const platform = process.platform;

  if (platform === 'darwin' && arch === 'arm64') return 'aarch64-apple-darwin';
  if (platform === 'darwin' && arch === 'x64') return 'x86_64-apple-darwin';
  if (platform === 'win32' && arch === 'x64') return 'x86_64-pc-windows-msvc';
  if (platform === 'linux' && arch === 'x64') return 'x86_64-unknown-linux-gnu';

  throw new Error(`Unsupported local platform for sidecar preparation: ${platform}/${arch}`);
}

function sidecarFileName(sidecar, target) {
  const suffix = isWindowsTarget(target) ? '.exe' : '';
  return `${sidecar}-${target}${suffix}`;
}

function isWindowsTarget(target) {
  return target.includes('windows') || target.includes('msvc') || target.includes('pc-windows');
}

function currentHostCanPrepareTarget(target) {
  return detectCurrentTarget() === target;
}

async function fetchJson(url, timeoutMs) {
  const response = await fetchWithTimeout(url, timeoutMs);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }
  return response.json();
}

async function fetchText(url, timeoutMs) {
  const response = await fetchWithTimeout(url, timeoutMs);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }
  return response.text();
}

async function fetchBuffer(url, timeoutMs) {
  const response = await fetchWithTimeout(url, timeoutMs);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: { 'user-agent': USER_AGENT },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function selectYtdlpAsset(release, target) {
  const candidates = isWindowsTarget(target)
    ? ['yt-dlp.exe']
    : target.includes('apple-darwin')
      ? ['yt-dlp_macos', 'yt-dlp']
      : ['yt-dlp_linux', 'yt-dlp'];

  for (const name of candidates) {
    const asset = release.assets?.find(candidate => candidate.name === name);
    if (asset) return asset;
  }

  throw new Error(`No yt-dlp release asset matched target ${target}`);
}

function parseChecksum(sumsText, assetName) {
  for (const line of sumsText.split(/\r?\n/u)) {
    const [hash, name] = line.trim().split(/\s+/u);
    if (name?.replace(/^\.\//u, '') === assetName) {
      return hash;
    }
  }

  throw new Error(`No checksum entry found for ${assetName}`);
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function prepareYtdlp({ target, outputPath, timeoutMs }) {
  const override = process.env.VDP_YTDLP_BINARY;
  if (override) {
    copyExecutable(override, outputPath);
    return `copied ${override}`;
  }

  const release = await fetchJson(
    'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest',
    timeoutMs
  );
  const asset = selectYtdlpAsset(release, target);
  const sums = release.assets?.find(candidate => candidate.name === 'SHA2-256SUMS');
  if (!sums) {
    throw new Error('yt-dlp release is missing SHA2-256SUMS');
  }

  const [binary, sumsText] = await Promise.all([
    fetchBuffer(asset.browser_download_url, timeoutMs),
    fetchText(sums.browser_download_url, timeoutMs),
  ]);
  const expected = parseChecksum(sumsText, asset.name);
  const actual = sha256(binary);
  if (actual !== expected) {
    throw new Error(`yt-dlp checksum mismatch: expected ${expected}, got ${actual}`);
  }

  writeExecutable(outputPath, binary);
  return `downloaded ${asset.name} from ${release.tag_name}`;
}

function prepareFfmpeg({ target, outputPath }) {
  const override = process.env.VDP_FFMPEG_BINARY;
  if (override) {
    copyExecutable(override, outputPath);
    return `copied ${override}`;
  }

  if (!currentHostCanPrepareTarget(target)) {
    throw new Error(
      `ffmpeg-static can only prepare the current host target. Set VDP_FFMPEG_BINARY for ${target}.`
    );
  }

  const ffmpegPath = require('ffmpeg-static');
  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
    throw new Error('ffmpeg-static did not provide a usable ffmpeg binary');
  }

  copyExecutable(ffmpegPath, outputPath);
  return `copied ffmpeg-static from ${ffmpegPath}`;
}

function copyExecutable(source, destination) {
  if (!fs.existsSync(source)) {
    throw new Error(`Sidecar source does not exist: ${source}`);
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  makeExecutable(destination);
}

function writeExecutable(destination, bytes) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, bytes);
  makeExecutable(destination);
}

function makeExecutable(filePath) {
  if (process.platform !== 'win32') {
    fs.chmodSync(filePath, 0o755);
  }
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const binariesDir = path.resolve(ROOT, options.binariesDir);

  if (!options.skipYtdlp) {
    const ytdlpPath = path.join(binariesDir, sidecarFileName('yt-dlp', options.target));
    const summary = await prepareYtdlp({
      target: options.target,
      outputPath: ytdlpPath,
      timeoutMs: options.timeoutMs,
    });
    console.log(`yt-dlp: ${summary}`);
  }

  if (!options.skipFfmpeg) {
    const ffmpegPath = path.join(binariesDir, sidecarFileName('ffmpeg', options.target));
    const summary = prepareFfmpeg({
      target: options.target,
      outputPath: ffmpegPath,
    });
    console.log(`ffmpeg: ${summary}`);
  }
}

run().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
