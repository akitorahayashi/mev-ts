import { expect } from 'bun:test';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { embeddedAssets } from '../../src/assets/registry';
import { runMake } from '../../src/provisioning/run';
import { fail, ok } from '../fixtures/fake-command-runner';
import { recordingContext } from '../fixtures/fake-context';
import { sandboxedTest } from '../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('herdr-provisioning-');

sandboxTest(
  'installs the self-updating binary and is idempotent',
  async (dir) => {
    const binary = join(dir, '.local/bin/herdr');
    const { context, calls } = recordingContext({
      home: dir,
      assets: embeddedAssets,
      basePath: '/usr/bin',
      async respond(command, args, options) {
        if (command === 'curl') {
          await writeFile(args[args.indexOf('-o') + 1] as string, 'installer');
          return ok();
        }
        if (command === 'sh') {
          expect(options?.env).toEqual({
            HERDR_INSTALL_DIR: join(dir, '.local/bin'),
            PATH: `${join(dir, '.local/bin')}:/usr/bin`,
          });
          await mkdir(join(dir, '.local/bin'), { recursive: true });
          await writeFile(binary, 'herdr');
          await chmod(binary, 0o755);
          return ok();
        }
        if (command === binary && args[0] === 'update') {
          return ok('updated to 0.8.3\n');
        }
        if (command === binary) return ok('herdr 0.8.2\n');
        return fail(`unexpected command: ${command}`);
      },
    });

    const first = await runMake({ selectors: ['herdr'] }, context);

    expect(first.failed).toBe(false);
    expect(first.selection.packages.formulae).toEqual([]);
    expect(calls.map((call) => call.command)).toEqual(['curl', 'sh', binary]);

    const firstCallCount = calls.length;
    const second = await runMake({ selectors: ['herdr'] }, context);

    expect(second.failed).toBe(false);
    expect(calls.slice(firstCallCount).map((call) => call.command)).toEqual([
      binary,
    ]);
    expect(second.groups[0]?.reports.map((report) => report.status)).toEqual([
      'unchanged',
      'unchanged',
      'unchanged',
    ]);

    const upgradeCallCount = calls.length;
    const upgraded = await runMake(
      { selectors: ['herdr'], upgrade: true },
      context,
    );

    expect(upgraded.failed).toBe(false);
    expect(calls.slice(upgradeCallCount).map((call) => call.command)).toEqual([
      binary,
      binary,
    ]);
    expect(calls.slice(upgradeCallCount).map((call) => call.args)).toEqual([
      ['update'],
      ['--version'],
    ]);
    expect(upgraded.groups[0]?.reports.map((report) => report.status)).toEqual([
      'unchanged',
      'changed',
      'unchanged',
    ]);
  },
);

sandboxTest('reports a direct installer failure', async (dir) => {
  const binary = join(dir, '.local/bin/herdr');
  const { context, calls } = recordingContext({
    home: dir,
    assets: embeddedAssets,
    async respond(command, args) {
      if (command === 'curl') {
        await writeFile(args[args.indexOf('-o') + 1] as string, 'installer');
        return ok();
      }
      if (command === 'sh') return fail('installer failed');
      if (command === binary) return fail('direct binary unavailable');
      return fail(`unexpected command: ${command}`);
    },
  });

  const report = await runMake({ selectors: ['herdr'] }, context);

  expect(report.failed).toBe(true);
  expect(calls.map((call) => call.command)).toEqual(['curl', 'sh']);
  expect(report.groups[0]?.reports[2]?.status).toBe('blocked');
});

sandboxTest('blocks self-update from inside a Herdr pane', async (dir) => {
  const binary = join(dir, '.local/bin/herdr');
  await mkdir(join(dir, '.local/bin'), { recursive: true });
  await writeFile(binary, 'herdr');
  const guidance =
    'run `herdr update` outside herdr after detaching from the session';
  const { context, calls } = recordingContext({
    home: dir,
    assets: embeddedAssets,
    respond(command, args) {
      if (command === binary && args[0] === 'update') {
        return fail(`update failed: ${guidance}`);
      }
      if (command === binary) return ok('herdr 0.8.2\n');
      return fail(`unexpected command: ${command}`);
    },
  });

  const report = await runMake(
    { selectors: ['herdr'], upgrade: true },
    context,
  );

  expect(report.failed).toBe(true);
  expect(calls.map((call) => [call.command, ...call.args])).toEqual([
    [binary, 'update'],
  ]);
  expect(report.groups[0]?.reports[1]).toMatchObject({
    status: 'blocked',
    error: `update failed: ${guidance}`,
  });
  expect(report.groups[0]?.reports[2]?.status).toBe('blocked');
});
