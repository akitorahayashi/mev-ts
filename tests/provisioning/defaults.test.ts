import { expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CommandResult } from '../../src/host/command';
import type { Context } from '../../src/host/context';
import {
  applyDefaults,
  runActivation,
} from '../../src/provisioning/activation';
import { withTemporaryDirectory } from '../fixtures/temporary-directory';

const CONFIG_KEY = 'system/global/defaults.yml';

async function withSandbox(fn: (dir: string) => Promise<void>): Promise<void> {
  await withTemporaryDirectory(fn, { prefix: 'defaults-' });
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
const readValue = (stdout: string): CommandResult => ({
  code: 0,
  stdout,
  stderr: '',
});

test('an empty defaults list reports unchanged', async () => {
  await withSandbox(async (dir) => {
    await deploy(dir, '[]\n');
    const { context, calls } = contextWith(dir, () => ok());

    const report = await runActivation(applyDefaults(CONFIG_KEY), context);

    expect(report.status).toBe('unchanged');
    expect(report.entries).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

test('matching defaults entry is reported unchanged without writing', async () => {
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
    const { context, calls } = contextWith(dir, (_command, args) =>
      args[0] === 'read'
        ? readValue('1\n')
        : args[0] === 'read-type'
          ? readValue('Type is boolean\n')
          : ok(),
    );

    const report = await runActivation(applyDefaults(CONFIG_KEY), context);

    expect(report.status).toBe('unchanged');
    expect(calls).toEqual([
      {
        command: 'defaults',
        args: ['read', 'com.apple.dock', 'autohide'],
      },
      {
        command: 'defaults',
        args: ['read-type', 'com.apple.dock', 'autohide'],
      },
    ]);
  });
});

test('matching defaults value with a different stored type is rewritten', async () => {
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
    const { context, calls } = contextWith(dir, (_command, args) =>
      args[0] === 'read'
        ? readValue('1\n')
        : args[0] === 'read-type'
          ? readValue('Type is integer\n')
          : ok(),
    );

    const report = await runActivation(applyDefaults(CONFIG_KEY), context);

    expect(report.status).toBe('changed');
    expect(calls.map((call) => call.args)).toEqual([
      ['read', 'com.apple.dock', 'autohide'],
      ['read-type', 'com.apple.dock', 'autohide'],
      ['write', 'com.apple.dock', 'autohide', '-bool', 'YES'],
    ]);
  });
});

test('differing defaults entry is written and reported changed', async () => {
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
    const { context, calls } = contextWith(dir, (_command, args) =>
      args[0] === 'read'
        ? readValue('0\n')
        : args[0] === 'read-type'
          ? readValue('Type is boolean\n')
          : ok(),
    );

    const report = await runActivation(applyDefaults(CONFIG_KEY), context);

    expect(report.status).toBe('changed');
    expect(calls.map((call) => call.args)).toEqual([
      ['read', 'com.apple.dock', 'autohide'],
      ['read-type', 'com.apple.dock', 'autohide'],
      ['write', 'com.apple.dock', 'autohide', '-bool', 'YES'],
    ]);
  });
});

test('a missing defaults key is written and reported changed', async () => {
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
    const { context, calls } = contextWith(dir, (_command, args) =>
      args[0] === 'read' ? fail('does not exist') : ok(),
    );

    const report = await runActivation(applyDefaults(CONFIG_KEY), context);

    expect(report.status).toBe('changed');
    expect(calls.map((call) => call.args)).toEqual([
      ['read', 'com.apple.dock', 'autohide'],
      ['write', 'com.apple.dock', 'autohide', '-bool', 'YES'],
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
    const { context } = contextWith(dir, (_command, args) =>
      args[0] === 'read' ? fail('does not exist') : fail('not permitted'),
    );

    const report = await runActivation(applyDefaults(CONFIG_KEY), context);

    expect(report.status).toBe('failed');
    expect(report.entries?.[0]?.error).toBe('not permitted');
  });
});

test('defaults string expansion replaces every home placeholder', async () => {
  await withSandbox(async (dir) => {
    await deploy(
      dir,
      [
        '- domain: com.example',
        '  key: Path',
        '  type: string',
        '  value: "$HOME/bin/$HOME/cache"',
        '',
      ].join('\n'),
    );
    const { context, calls } = contextWith(dir, (_command, args) =>
      args[0] === 'read' ? fail('does not exist') : ok(),
    );

    const report = await runActivation(applyDefaults(CONFIG_KEY), context);

    expect(report.status).toBe('changed');
    expect(calls[1]?.args).toEqual([
      'write',
      'com.example',
      'Path',
      '-string',
      `${dir}/bin/${dir}/cache`,
    ]);
  });
});

test('defaults manifest rejects missing required fields', async () => {
  await withSandbox(async (dir) => {
    await deploy(
      dir,
      ['- domain: com.apple.dock', '  type: bool', '  value: true', ''].join(
        '\n',
      ),
    );
    const { context, calls } = contextWith(dir, () => ok());

    const report = await runActivation(applyDefaults(CONFIG_KEY), context);

    expect(report.status).toBe('failed');
    expect(report.error).toContain("'key' must be a non-empty string");
    expect(calls).toHaveLength(0);
  });
});

test('defaults manifest rejects values incompatible with the declared type', async () => {
  await withSandbox(async (dir) => {
    await deploy(
      dir,
      [
        '- domain: com.apple.dock',
        '  key: autohide',
        '  type: bool',
        '  value: maybe',
        '',
      ].join('\n'),
    );
    const { context, calls } = contextWith(dir, () => ok());

    const report = await runActivation(applyDefaults(CONFIG_KEY), context);

    expect(report.status).toBe('failed');
    expect(report.error).toContain("'value' must be a boolean");
    expect(calls).toHaveLength(0);
  });
});
