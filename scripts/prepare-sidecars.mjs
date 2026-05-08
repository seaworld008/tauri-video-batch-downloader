#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { gunzipSync } from 'node:zlib';

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
    skipDeno: false,
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
    } else if (arg === '--skip-deno') {
      options.skipDeno = true;
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
  --skip-deno              Do not prepare Deno JavaScript runtime.

Environment:
  VDP_YTDLP_BINARY         Copy this trusted yt-dlp binary instead of downloading latest release.
  VDP_FFMPEG_BINARY        Copy this trusted ffmpeg binary instead of using ffmpeg-static.
  VDP_DENO_BINARY          Copy this trusted Deno binary instead of downloading latest release.
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

function ffmpegStaticTarget(target) {
  if (target === 'x86_64-pc-windows-msvc') return { platform: 'win32', arch: 'x64' };
  if (target === 'x86_64-apple-darwin') return { platform: 'darwin', arch: 'x64' };
  if (target === 'aarch64-apple-darwin') return { platform: 'darwin', arch: 'arm64' };
  if (target === 'x86_64-unknown-linux-gnu') return { platform: 'linux', arch: 'x64' };

  throw new Error(`Unsupported ffmpeg-static target: ${target}`);
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
  const headers = { 'user-agent': USER_AGENT };
  const githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (githubToken && new URL(url).hostname === 'api.github.com') {
    headers.authorization = `Bearer ${githubToken}`;
    headers.accept = 'application/vnd.github+json';
  }

  try {
    return await fetch(url, {
      headers,
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

function parseSingleChecksum(sumsText) {
  const hash = sumsText.match(/\b[a-fA-F0-9]{64}\b/u)?.[0];
  if (!hash) {
    throw new Error('Checksum file is empty');
  }
  return hash.toLowerCase();
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

function denoAssetName(target) {
  return `deno-${target}.zip`;
}

async function prepareDeno({ target, outputPath, timeoutMs }) {
  const override = process.env.VDP_DENO_BINARY;
  if (override) {
    copyExecutable(override, outputPath);
    return `copied ${override}`;
  }

  const release = await fetchJson(
    'https://api.github.com/repos/denoland/deno/releases/latest',
    timeoutMs
  );
  const assetName = denoAssetName(target);
  const asset = release.assets?.find(candidate => candidate.name === assetName);
  const sums = release.assets?.find(candidate => candidate.name === `${assetName}.sha256sum`);
  if (!asset || !sums) {
    throw new Error(`Deno release ${release.tag_name ?? ''} is missing ${assetName} or checksum`);
  }

  const [archive, sumsText] = await Promise.all([
    fetchBuffer(asset.browser_download_url, timeoutMs),
    fetchText(sums.browser_download_url, timeoutMs),
  ]);
  const expected = parseSingleChecksum(sumsText);
  const actual = sha256(archive);
  if (actual !== expected) {
    throw new Error(`Deno checksum mismatch: expected ${expected}, got ${actual}`);
  }

  extractDenoArchive({
    archive,
    outputPath,
    executableName: isWindowsTarget(target) ? 'deno.exe' : 'deno',
  });
  return `downloaded ${assetName} from ${release.tag_name}`;
}

function extractDenoArchive({ archive, outputPath, executableName }) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vdp-deno-'));
  const archivePath = path.join(tempDir, 'deno.zip');
  fs.writeFileSync(archivePath, archive);
  try {
    const result = spawnSync('unzip', ['-q', archivePath, '-d', tempDir], {
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || `unzip exited with ${result.status}`);
    }

    const extracted = findFileByName(tempDir, executableName);
    if (!extracted) {
      throw new Error(`Deno archive did not contain ${executableName}`);
    }
    copyExecutable(extracted, outputPath);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function findFileByName(dir, expectedName) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = findFileByName(absolute, expectedName);
      if (nested) return nested;
    } else if (entry.isFile() && entry.name === expectedName) {
      return absolute;
    }
  }
  return null;
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

async function downloadFfmpegStatic({ target, outputPath, timeoutMs }) {
  const { platform, arch } = ffmpegStaticTarget(target);
  const pkgConfig = require('ffmpeg-static/package.json')['ffmpeg-static'];
  const release =
    process.env[pkgConfig['binary-release-tag-env-var']] || pkgConfig['binary-release-tag'];
  const downloadsUrl =
    process.env.FFMPEG_BINARIES_URL ||
    'https://github.com/eugeneware/ffmpeg-static/releases/download';
  const executableBaseName = pkgConfig['executable-base-name'];
  const downloadUrl = `${downloadsUrl}/${release}/${executableBaseName}-${platform}-${arch}.gz`;
  const binary = gunzipSync(await fetchBuffer(downloadUrl, timeoutMs));

  writeExecutable(outputPath, binary);
  return `downloaded ffmpeg-static ${release} for ${platform}/${arch}`;
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
    const summary = currentHostCanPrepareTarget(options.target)
      ? prepareFfmpeg({
          target: options.target,
          outputPath: ffmpegPath,
        })
      : await downloadFfmpegStatic({
          target: options.target,
          outputPath: ffmpegPath,
          timeoutMs: options.timeoutMs,
        });
    console.log(`ffmpeg: ${summary}`);
  }

  if (!options.skipDeno) {
    const denoPath = path.join(binariesDir, sidecarFileName('deno', options.target));
    const summary = await prepareDeno({
      target: options.target,
      outputPath: denoPath,
      timeoutMs: options.timeoutMs,
    });
    console.log(`deno: ${summary}`);
  }
}

run().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
