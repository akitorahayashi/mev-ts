import { expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CommandResult } from '../../src/host/command';
import type { Context } from '../../src/host/context';
import { applyDuti, runActivation } from '../../src/provisioning/activation';

const CONFIG_KEY = 'duti/global/default_apps.yml';

const YAML = `
default_apps:
  - bundle_id: dev.zed.Zed
    extensions: [md, txt]
  - bundle_id: com.apple.Preview
    extensions: [pdf]
`.trimStart();

async function withSandbox(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = join(
    process.cwd(),
    '.tmp',
    `duti-${process.pid}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  try {
    await fn(dir);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}

async function deployConfig(dir: string): Promise<void> {
  const roleDir = join(dir, '.config', 'mev', 'roles', 'duti', 'global');
  await mkdir(roleDir, { recursive: true });
  await writeFile(join(roleDir, 'default_apps.yml'), YAML);
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

test('unchanged when duti -x returns the correct bundle_id', async () => {
  await withSandbox(async (dir) => {
    await deployConfig(dir);
    const { context, calls } = contextWith(dir, (cmd, args) => {
      if (cmd === 'duti' && args[0] === '-x') {
        const ext = args[1] as string;
        const map: Record<string, string> = {
          md: 'dev.zed.Zed',
          txt: 'dev.zed.Zed',
          pdf: 'com.apple.Preview',
        };
        return ok(`some info\n${map[ext] ?? ''}`);
      }
      return fail();
    });

    const report = await runActivation(applyDuti(CONFIG_KEY), context);

    expect(report.status).toBe('unchanged');
    expect(calls.every((c) => c.args[0] === '-x')).toBe(true);
    expect(report.entries?.every((e) => e.status === 'unchanged')).toBe(true);
  });
});

test('changed when duti -x returns a different bundle_id', async () => {
  await withSandbox(async (dir) => {
    await deployConfig(dir);
    const { context, calls } = contextWith(dir, (cmd, args) => {
      if (cmd === 'duti' && args[0] === '-x') return ok('com.other.App');
      if (cmd === 'duti' && args[0] === '-s') return ok();
      return fail();
    });

    const report = await runActivation(applyDuti(CONFIG_KEY), context);

    expect(report.status).toBe('changed');
    const sets = calls.filter((c) => c.args[0] === '-s');
    expect(sets).toHaveLength(3);
    expect(report.entries?.every((e) => e.status === 'changed')).toBe(true);
  });
});

test('applies when duti -x fails (extension not yet registered)', async () => {
  await withSandbox(async (dir) => {
    await deployConfig(dir);
    const { context } = contextWith(dir, (cmd, args) => {
      if (cmd === 'duti' && args[0] === '-x') return fail('no handler');
      if (cmd === 'duti' && args[0] === '-s') return ok();
      return fail();
    });

    const report = await runActivation(applyDuti(CONFIG_KEY), context);

    expect(report.status).toBe('changed');
  });
});

test('failed when a duti config extension is not a string', async () => {
  await withSandbox(async (dir) => {
    const roleDir = join(dir, '.config', 'mev', 'roles', 'duti', 'global');
    await mkdir(roleDir, { recursive: true });
    await writeFile(
      join(roleDir, 'default_apps.yml'),
      'default_apps:\n  - bundle_id: dev.zed.Zed\n    extensions: [md, 42]\n',
    );
    const { context, calls } = contextWith(dir, () => ok());

    const report = await runActivation(applyDuti(CONFIG_KEY), context);

    expect(report.status).toBe('failed');
    expect(report.error).toContain('extensions array of strings');
    expect(calls).toHaveLength(0);
  });
});

test('failed when duti -s returns non-zero', async () => {
  await withSandbox(async (dir) => {
    await deployConfig(dir);
    const { context } = contextWith(dir, (cmd, args) => {
      if (cmd === 'duti' && args[0] === '-x') return fail();
      if (cmd === 'duti' && args[0] === '-s') return fail('permission denied');
      return fail();
    });

    const report = await runActivation(applyDuti(CONFIG_KEY), context);

    expect(report.status).toBe('failed');
    expect(report.entries?.[0]?.error).toBe('permission denied');
  });
});
