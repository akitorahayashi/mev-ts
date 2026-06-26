import { expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CommandResult } from '../../src/host/command';
import type { Context } from '../../src/host/context';
import {
  applyDefaults,
  runActivation,
} from '../../src/provisioning/activation';

const CONFIG_KEY = 'system/global/defaults.yml';

async function withSandbox(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = join(
    process.cwd(),
    '.tmp',
    `defaults-${process.pid}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  try {
    await fn(dir);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}

async function deploy(dir: string, yaml: string): Promise<void> {
  const roleDir = join(dir, '.config', 'mev', 'roles', 'system', 'global');
  await mkdir(roleDir, { recursive: true });
  await writeFile(join(roleDir, 'defaults.yml'), yaml);
}

function contextWith(
  home: string,
  responder: (command: string, args: readonly string[]) => CommandResult,
): { context: Context; calls: { command: string; args: readonly string[] }[] } {
  const calls: { command: string; args: readonly string[] }[] = [];
  const context: Context = {
    home,
    overwrite: false,
    assets: {
      async read() {
        return '';
      },
      keysByPrefix() {
        return [];
      },
      isExecutable() {
        return false;
      },
    },
    commands: {
      async run(command, args) {
        calls.push({ command, args });
        return responder(command, args);
      },
    },
  };
  return { context, calls };
}

const ok = (): CommandResult => ({ code: 0, stdout: '', stderr: '' });
const fail = (stderr = ''): CommandResult => ({ code: 1, stdout: '', stderr });

test('an empty defaults list reports unchanged', async () => {
  await withSandbox(async (dir) => {
    await deploy(dir, '[]\n');
    const { context, calls } = contextWith(dir, () => ok());

    const report = await runActivation(
      applyDefaults(CONFIG_KEY),
      context,
      false,
    );

    expect(report.status).toBe('unchanged');
    expect(report.entries).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

test('each successful write is reported changed', async () => {
  await withSandbox(async (dir) => {
    await deploy(
      dir,
      [
        '- domain: com.apple.dock',
        '  key: autohide',
        '  type: bool',
        '  value: true',
        '',
      ].join('\n'),
    );
    const { context, calls } = contextWith(dir, () => ok());

    const report = await runActivation(
      applyDefaults(CONFIG_KEY),
      context,
      false,
    );

    expect(report.status).toBe('changed');
    expect(calls[0]?.args).toEqual([
      'write',
      'com.apple.dock',
      'autohide',
      '-bool',
      'YES',
    ]);
  });
});

test('a failed write marks the activation failed', async () => {
  await withSandbox(async (dir) => {
    await deploy(
      dir,
      [
        '- domain: com.apple.dock',
        '  key: autohide',
        '  type: bool',
        '  value: true',
        '',
      ].join('\n'),
    );
    const { context } = contextWith(dir, () => fail('not permitted'));

    const report = await runActivation(
      applyDefaults(CONFIG_KEY),
      context,
      false,
    );

    expect(report.status).toBe('failed');
    expect(report.entries?.[0]?.error).toBe('not permitted');
  });
});
