import { expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CommandResult } from '../../src/host/command';
import type { Context } from '../../src/host/context';
import {
  installExtensions,
  runActivation,
} from '../../src/provisioning/activation';

const CONFIG_KEY = 'editor/vscode/global/extensions.json';

const MANIFEST = JSON.stringify({
  extensions: ['publisher.alpha', 'publisher.Beta', 'publisher.gamma'],
});

async function withSandbox(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = join(
    process.cwd(),
    '.tmp',
    `extensions-${process.pid}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  try {
    await fn(dir);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}

async function deployManifest(dir: string): Promise<void> {
  const roleDir = join(dir, '.config/mev/roles/editor/vscode/global');
  await mkdir(roleDir, { recursive: true });
  await writeFile(join(roleDir, 'extensions.json'), MANIFEST);
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

const ok = (stdout = ''): CommandResult => ({ code: 0, stdout, stderr: '' });
const fail = (stderr = ''): CommandResult => ({ code: 1, stdout: '', stderr });

test('unchanged when every desired extension is already installed', async () => {
  await withSandbox(async (dir) => {
    await deployManifest(dir);
    const { context, calls } = contextWith(dir, (_cmd, args) => {
      if (args[0] === '--list-extensions') {
        // Different casing must still count as installed.
        return ok('publisher.Alpha\npublisher.beta\npublisher.GAMMA');
      }
      return fail();
    });

    const report = await runActivation(
      installExtensions('code', CONFIG_KEY),
      context,
    );

    expect(report.status).toBe('unchanged');
    expect(calls).toHaveLength(1);
    expect(report.entries?.every((e) => e.status === 'unchanged')).toBe(true);
  });
});

test('installs only the missing extensions', async () => {
  await withSandbox(async (dir) => {
    await deployManifest(dir);
    const { context, calls } = contextWith(dir, (_cmd, args) => {
      if (args[0] === '--list-extensions') return ok('publisher.beta');
      if (args[0] === '--install-extension') return ok();
      return fail();
    });

    const report = await runActivation(
      installExtensions('code', CONFIG_KEY),
      context,
    );

    expect(report.status).toBe('changed');
    const installs = calls.filter((c) => c.args[0] === '--install-extension');
    expect(installs.map((c) => c.args[1])).toEqual([
      'publisher.alpha',
      'publisher.gamma',
    ]);
  });
});

test('failed when an install command returns non-zero', async () => {
  await withSandbox(async (dir) => {
    await deployManifest(dir);
    const { context } = contextWith(dir, (_cmd, args) => {
      if (args[0] === '--list-extensions') return ok('');
      if (args[0] === '--install-extension') return fail('network error');
      return fail();
    });

    const report = await runActivation(
      installExtensions('code', CONFIG_KEY),
      context,
    );

    expect(report.status).toBe('failed');
    expect(report.entries?.some((e) => e.error === 'network error')).toBe(true);
  });
});

test('failed when the editor CLI is unavailable', async () => {
  await withSandbox(async (dir) => {
    await deployManifest(dir);
    const { context } = contextWith(dir, () => fail('command not found'));

    const report = await runActivation(
      installExtensions('code', CONFIG_KEY),
      context,
    );

    expect(report.status).toBe('failed');
  });
});

test('failed when the extension manifest contains invalid entries', async () => {
  await withSandbox(async (dir) => {
    const roleDir = join(dir, '.config/mev/roles/editor/vscode/global');
    await mkdir(roleDir, { recursive: true });
    await writeFile(
      join(roleDir, 'extensions.json'),
      JSON.stringify({ extensions: ['publisher.alpha', '  '] }),
    );
    const { context, calls } = contextWith(dir, () => ok());

    const report = await runActivation(
      installExtensions('code', CONFIG_KEY),
      context,
    );

    expect(report.status).toBe('failed');
    expect(report.error).toContain('extensions array of non-empty strings');
    expect(calls).toHaveLength(0);
  });
});
