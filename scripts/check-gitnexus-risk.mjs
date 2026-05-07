#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const allowCritical =
  args.includes('--allow-critical') ||
  process.env.GITNEXUS_ALLOW_CRITICAL === '1' ||
  process.env.ALLOW_CRITICAL_GITNEXUS === '1';

const scope = readOption('--scope') ?? 'all';
const baseRef = readOption('--base-ref');
const command = ['gitnexus', 'detect-changes', '--scope', scope];
if (baseRef) command.push('--base-ref', baseRef);

const result = spawnSync('npx', command, {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});

const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const risk = output.match(/Risk level:\s*([a-z]+)/i)?.[1]?.toLowerCase();
if (!risk) {
  console.error('[gitnexus-risk] Cannot find risk level in gitnexus output.');
  process.exit(1);
}

if (risk === 'critical' && !allowCritical) {
  console.error(
    [
      '[gitnexus-risk] Critical impact detected.',
      '普通 PR 不应携带 critical 影响面；请拆小提交或解耦高连接模块。',
      '核心迁移可显式设置 GITNEXUS_ALLOW_CRITICAL=1，或传入 --allow-critical 并在 PR 中说明原因。',
    ].join('\n')
  );
  process.exit(1);
}

console.log(`[gitnexus-risk] Risk level accepted: ${risk}`);

function readOption(name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  return value && !value.startsWith('--') ? value : undefined;
}
