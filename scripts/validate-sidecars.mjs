#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CONFIG = 'src-tauri/tauri.conf.json';
const DEFAULT_CAPABILITY = 'src-tauri/capabilities/migrated.json';
const DEFAULT_BINARIES_DIR = 'src-tauri/binaries';
const SIDECARS = ['yt-dlp', 'ffmpeg', 'deno'];
const RELEASE_TARGETS = [
  'x86_64-pc-windows-msvc',
  'x86_64-apple-darwin',
  'aarch64-apple-darwin',
  'universal-apple-darwin',
];

const MIN_REAL_BINARY_BYTES = {
  'yt-dlp': 1024 * 1024,
  ffmpeg: 1024 * 1024,
  deno: 1024 * 1024,
};

const PLACEHOLDER_MARKERS = ['sidecar placeholder', 'replace with the real', 'replace with real'];

function parseArgs(argv) {
  const options = {
    allowPlaceholders: false,
    all: false,
    targets: [],
    config: DEFAULT_CONFIG,
    capability: DEFAULT_CAPABILITY,
    binariesDir: DEFAULT_BINARIES_DIR,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--allow-placeholders') {
      options.allowPlaceholders = true;
    } else if (arg === '--all') {
      options.all = true;
    } else if (arg === '--target') {
      const target = argv[index + 1];
      if (!target) {
        throw new Error('--target requires a Rust target triple');
      }
      options.targets.push(target);
      index += 1;
    } else if (arg === '--config') {
      options.config = readRequiredOption(argv, index, '--config');
      index += 1;
    } else if (arg === '--capability') {
      options.capability = readRequiredOption(argv, index, '--capability');
      index += 1;
    } else if (arg === '--binaries-dir') {
      options.binariesDir = readRequiredOption(argv, index, '--binaries-dir');
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (options.all) {
    options.targets = RELEASE_TARGETS;
  }

  if (options.targets.length === 0) {
    options.targets = [detectCurrentTarget()];
  }

  options.targets = [...new Set(options.targets)];
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
  console.log(`Usage: node scripts/validate-sidecars.mjs [options]

Options:
  --target <triple>        Validate one target triple. Can be repeated.
  --all                    Validate all release triples used by this repo.
  --allow-placeholders     Allow placeholder or tiny files for local smoke builds.
  --config <path>          Tauri config path. Default: ${DEFAULT_CONFIG}
  --capability <path>      Tauri capability path. Default: ${DEFAULT_CAPABILITY}
  --binaries-dir <path>    Sidecar directory. Default: ${DEFAULT_BINARIES_DIR}
`);
}

function detectCurrentTarget() {
  const arch = process.arch;
  const platform = process.platform;

  if (platform === 'darwin' && arch === 'arm64') {
    return 'aarch64-apple-darwin';
  }
  if (platform === 'darwin' && arch === 'x64') {
    return 'x86_64-apple-darwin';
  }
  if (platform === 'win32' && arch === 'x64') {
    return 'x86_64-pc-windows-msvc';
  }
  if (platform === 'linux' && arch === 'x64') {
    return 'x86_64-unknown-linux-gnu';
  }

  throw new Error(`Unsupported local platform for sidecar validation: ${platform}/${arch}`);
}

function readJson(relativePath) {
  const absolutePath = path.resolve(ROOT, relativePath);
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
}

function validateTauriConfig(config) {
  const externalBin = config?.bundle?.externalBin ?? [];
  const missing = SIDECARS.filter(name => !externalBin.includes(`binaries/${name}`));

  if (missing.length > 0) {
    return [`tauri.conf.json bundle.externalBin is missing: ${missing.join(', ')}`];
  }

  return [];
}

function validateCapability(capability) {
  const permissions = capability?.permissions ?? [];
  const expectedIdentifiers = ['shell:allow-execute', 'shell:allow-spawn'];
  const issues = [];

  for (const identifier of expectedIdentifiers) {
    const permission = permissions.find(entry => entry?.identifier === identifier);
    if (!permission) {
      issues.push(`capability is missing ${identifier}`);
      continue;
    }

    for (const name of SIDECARS) {
      const scoped = permission.allow?.some(
        entry => entry.name === `binaries/${name}` && entry.sidecar === true && entry.args === true
      );
      if (!scoped) {
        issues.push(`capability ${identifier} is missing sidecar scope for binaries/${name}`);
      }
    }
  }

  return issues;
}

function validateSidecarFile({ binariesDir, sidecar, target, allowPlaceholders }) {
  const relativePath = path.join(binariesDir, sidecarFileName(sidecar, target));
  const absolutePath = path.resolve(ROOT, relativePath);
  const issues = [];
  const warnings = [];

  if (!fs.existsSync(absolutePath)) {
    return { issues: [`missing sidecar file: ${relativePath}`], warnings };
  }

  const stat = fs.statSync(absolutePath);
  if (!stat.isFile()) {
    issues.push(`sidecar path is not a regular file: ${relativePath}`);
  }

  if (!isWindowsTarget(target) && (stat.mode & 0o111) === 0) {
    issues.push(`sidecar is not executable: ${relativePath}`);
  }

  const sample = readFileStart(absolutePath, 512).toLowerCase();
  const placeholder = PLACEHOLDER_MARKERS.some(marker => sample.includes(marker));
  const tiny = stat.size < MIN_REAL_BINARY_BYTES[sidecar];

  if (placeholder || tiny) {
    const message = `${relativePath} looks like a placeholder or incomplete binary (${stat.size} bytes)`;
    if (allowPlaceholders) {
      warnings.push(message);
    } else {
      issues.push(message);
    }
  }

  return { issues, warnings };
}

function sidecarFileName(sidecar, target) {
  const suffix = isWindowsTarget(target) ? '.exe' : '';
  return `${sidecar}-${target}${suffix}`;
}

function isWindowsTarget(target) {
  return target.includes('windows') || target.includes('msvc') || target.includes('pc-windows');
}

function readFileStart(filePath, bytes) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const bytesRead = fs.readSync(fd, buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function run() {
  const options = parseArgs(process.argv.slice(2));
  const config = readJson(options.config);
  const capability = readJson(options.capability);
  const issues = [...validateTauriConfig(config), ...validateCapability(capability)];
  const warnings = [];

  for (const target of options.targets) {
    for (const sidecar of SIDECARS) {
      const result = validateSidecarFile({
        binariesDir: options.binariesDir,
        sidecar,
        target,
        allowPlaceholders: options.allowPlaceholders,
      });
      issues.push(...result.issues);
      warnings.push(...result.warnings);
    }
  }

  for (const warning of warnings) {
    console.warn(`warning: ${warning}`);
  }

  if (issues.length > 0) {
    console.error('Sidecar validation failed:');
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }
    process.exit(1);
  }

  console.log(`Sidecar validation passed for ${options.targets.join(', ')}`);
}

try {
  run();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
