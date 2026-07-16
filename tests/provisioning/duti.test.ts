import { expect } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CommandResult } from '../../src/host/command';
import { applyDuti, runActivation } from '../../src/provisioning/activation';
import { recordingContext } from '../fixtures/fake-context';
import { sandboxedTest } from '../fixtures/temporary-directory';

const CONFIG_KEY = 'duti/global/default_apps.yml';

const YAML = `
default_apps:
  - bundle_id: dev.zed.Zed
    extensions: [md, txt]
  - bundle_id: com.apple.Preview
    extensions: [pdf]
`.trimStart();

const sandboxTest = sandboxedTest('duti-');

async function deployConfig(dir: string): Promise<void> {
  const roleDir = join(dir, '.config', 'mev', 'roles', 'duti', 'global');
  await mkdir(roleDir, { recursive: true });
  await writeFile(join(roleDir, 'default_apps.yml'), YAML);
}

const ok = (stdout = ''): CommandResult => ({ code: 0, stdout, stderr: '' });
const fail = (stderr = ''): CommandResult => ({ code: 1, stdout: '', stderr });

sandboxTest(
  'unchanged when duti -x returns the correct bundle_id',
  async (dir) => {
    await deployConfig(dir);
    const { context, calls } = recordingContext({
      home: dir,
      respond: (cmd, args) => {
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
      },
    });

    const report = await runActivation(applyDuti(CONFIG_KEY), context);

    expect(report.status).toBe('unchanged');
    expect(calls.every((c) => c.args[0] === '-x')).toBe(true);
    expect(report.entries?.every((e) => e.status === 'unchanged')).toBe(true);
  },
);

sandboxTest(
  'changed when duti -x returns a different bundle_id',
  async (dir) => {
    await deployConfig(dir);
    const { context, calls } = recordingContext({
      home: dir,
      respond: (cmd, args) => {
        if (cmd === 'duti' && args[0] === '-x') return ok('com.other.App');
        if (cmd === 'duti' && args[0] === '-s') return ok();
        return fail();
      },
    });

    const report = await runActivation(applyDuti(CONFIG_KEY), context);

    expect(report.status).toBe('changed');
    const sets = calls.filter((c) => c.args[0] === '-s');
    expect(sets).toHaveLength(3);
    expect(report.entries?.every((e) => e.status === 'changed')).toBe(true);
  },
);

sandboxTest(
  'unchanged when duti -x returns a bundle_id containing an underscore',
  async (dir) => {
    const roleDir = join(dir, '.config', 'mev', 'roles', 'duti', 'global');
    await mkdir(roleDir, { recursive: true });
    await writeFile(
      join(roleDir, 'default_apps.yml'),
      'default_apps:\n  - bundle_id: com.example.my_app\n    extensions: [md]\n',
    );
    const { context, calls } = recordingContext({
      home: dir,
      respond: (cmd, args) => {
        if (cmd === 'duti' && args[0] === '-x') {
          return ok('handler info\ncom.example.my_app');
        }
        return fail();
      },
    });

    const report = await runActivation(applyDuti(CONFIG_KEY), context);

    expect(report.status).toBe('unchanged');
    expect(calls.some((c) => c.args[0] === '-s')).toBe(false);
  },
);

sandboxTest(
  'applies when duti -x fails (extension not yet registered)',
  async (dir) => {
    await deployConfig(dir);
    const { context } = recordingContext({
      home: dir,
      respond: (cmd, args) => {
        if (cmd === 'duti' && args[0] === '-x') return fail('no handler');
        if (cmd === 'duti' && args[0] === '-s') return ok();
        return fail();
      },
    });

    const report = await runActivation(applyDuti(CONFIG_KEY), context);

    expect(report.status).toBe('changed');
  },
);

sandboxTest(
  'failed when a duti config extension is not a string',
  async (dir) => {
    const roleDir = join(dir, '.config', 'mev', 'roles', 'duti', 'global');
    await mkdir(roleDir, { recursive: true });
    await writeFile(
      join(roleDir, 'default_apps.yml'),
      'default_apps:\n  - bundle_id: dev.zed.Zed\n    extensions: [md, 42]\n',
    );
    const { context, calls } = recordingContext({
      home: dir,
      respond: () => ok(),
    });

    const report = await runActivation(applyDuti(CONFIG_KEY), context);

    expect(report.status).toBe('failed');
    expect(report.error).toContain('extensions array of strings');
    expect(calls).toHaveLength(0);
  },
);

sandboxTest('failed when duti -s returns non-zero', async (dir) => {
  await deployConfig(dir);
  const { context } = recordingContext({
    home: dir,
    respond: (cmd, args) => {
      if (cmd === 'duti' && args[0] === '-x') return fail();
      if (cmd === 'duti' && args[0] === '-s') return fail('permission denied');
      return fail();
    },
  });

  const report = await runActivation(applyDuti(CONFIG_KEY), context);

  expect(report.status).toBe('failed');
  expect(report.entries?.[0]?.error).toContain('permission denied');
});

sandboxTest(
  'a missing duti binary (code 127) fails the item instead of registering',
  async (dir) => {
    await deployConfig(dir);
    const { context, calls } = recordingContext({
      home: dir,
      respond: (cmd, args) => {
        if (cmd === 'duti' && args[0] === '-x') {
          return { code: 127, stdout: '', stderr: 'duti: command not found' };
        }
        return ok();
      },
    });

    const report = await runActivation(applyDuti(CONFIG_KEY), context);

    expect(report.status).toBe('failed');
    expect(report.entries?.[0]?.error).toContain('command not found');
    // The broken probe must never fall through to a `duti -s` registration.
    expect(calls.some((c) => c.args[0] === '-s')).toBe(false);
  },
);
