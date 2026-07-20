import { expect } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CommandResult } from '../../src/host/command';
import {
  applyDefaults,
  runActivation,
} from '../../src/provisioning/activation';
import { recordingContext } from '../fixtures/fake-context';
import { sandboxedTest } from '../fixtures/temporary-directory';

const CONFIG_KEY = 'system/defaults.yml';

const sandboxTest = sandboxedTest('defaults-');

async function deploy(dir: string, yaml: string): Promise<void> {
  const roleDir = join(dir, '.mev', 'roles', 'system');
  await mkdir(roleDir, { recursive: true });
  await writeFile(join(roleDir, 'defaults.yml'), yaml);
}

const ok = (): CommandResult => ({ code: 0, stdout: '', stderr: '' });
const fail = (stderr = ''): CommandResult => ({ code: 1, stdout: '', stderr });
const readValue = (stdout: string): CommandResult => ({
  code: 0,
  stdout,
  stderr: '',
});

const BOOL_ENTRY = [
  '- domain: com.apple.dock',
  '  key: autohide',
  '  type: bool',
  '  value: true',
  '',
].join('\n');

sandboxTest('an empty defaults list reports unchanged', async (dir) => {
  await deploy(dir, '[]\n');
  const { context, calls } = recordingContext({
    home: dir,
    respond: () => ok(),
  });

  const report = await runActivation(applyDefaults(CONFIG_KEY), context);

  expect(report.status).toBe('unchanged');
  expect(report.entries).toEqual([]);
  expect(calls).toHaveLength(0);
});

sandboxTest(
  'matching defaults entry is reported unchanged without writing',
  async (dir) => {
    await deploy(dir, BOOL_ENTRY);
    const { context, calls } = recordingContext({
      home: dir,
      respond: (_command, args) =>
        args[0] === 'read'
          ? readValue('1\n')
          : args[0] === 'read-type'
            ? readValue('Type is boolean\n')
            : ok(),
    });

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
  },
);

sandboxTest(
  'matching defaults value with a different stored type is rewritten',
  async (dir) => {
    await deploy(dir, BOOL_ENTRY);
    const { context, calls } = recordingContext({
      home: dir,
      respond: (_command, args) =>
        args[0] === 'read'
          ? readValue('1\n')
          : args[0] === 'read-type'
            ? readValue('Type is integer\n')
            : ok(),
    });

    const report = await runActivation(applyDefaults(CONFIG_KEY), context);

    expect(report.status).toBe('changed');
    expect(calls.map((call) => call.args)).toEqual([
      ['read', 'com.apple.dock', 'autohide'],
      ['read-type', 'com.apple.dock', 'autohide'],
      ['write', 'com.apple.dock', 'autohide', '-bool', 'YES'],
    ]);
  },
);

sandboxTest(
  'differing defaults entry is written and reported changed',
  async (dir) => {
    await deploy(dir, BOOL_ENTRY);
    const { context, calls } = recordingContext({
      home: dir,
      respond: (_command, args) =>
        args[0] === 'read'
          ? readValue('0\n')
          : args[0] === 'read-type'
            ? readValue('Type is boolean\n')
            : ok(),
    });

    const report = await runActivation(applyDefaults(CONFIG_KEY), context);

    expect(report.status).toBe('changed');
    expect(calls.map((call) => call.args)).toEqual([
      ['read', 'com.apple.dock', 'autohide'],
      ['read-type', 'com.apple.dock', 'autohide'],
      ['write', 'com.apple.dock', 'autohide', '-bool', 'YES'],
    ]);
  },
);

sandboxTest(
  'a missing defaults key is written and reported changed',
  async (dir) => {
    await deploy(dir, BOOL_ENTRY);
    const { context, calls } = recordingContext({
      home: dir,
      respond: (_command, args) =>
        args[0] === 'read' ? fail('does not exist') : ok(),
    });

    const report = await runActivation(applyDefaults(CONFIG_KEY), context);

    expect(report.status).toBe('changed');
    expect(calls.map((call) => call.args)).toEqual([
      ['read', 'com.apple.dock', 'autohide'],
      ['write', 'com.apple.dock', 'autohide', '-bool', 'YES'],
    ]);
  },
);

sandboxTest('a failed write marks the activation failed', async (dir) => {
  await deploy(dir, BOOL_ENTRY);
  const { context } = recordingContext({
    home: dir,
    respond: (_command, args) =>
      args[0] === 'read' ? fail('does not exist') : fail('not permitted'),
  });

  const report = await runActivation(applyDefaults(CONFIG_KEY), context);

  expect(report.status).toBe('failed');
  expect(report.entries?.[0]?.error).toContain('not permitted');
});

sandboxTest(
  'defaults string expansion replaces every home placeholder',
  async (dir) => {
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
    const { context, calls } = recordingContext({
      home: dir,
      respond: (_command, args) =>
        args[0] === 'read' ? fail('does not exist') : ok(),
    });

    const report = await runActivation(applyDefaults(CONFIG_KEY), context);

    expect(report.status).toBe('changed');
    expect(calls[1]?.args).toEqual([
      'write',
      'com.example',
      'Path',
      '-string',
      `${dir}/bin/${dir}/cache`,
    ]);
  },
);

sandboxTest(
  'defaults manifest rejects missing required fields',
  async (dir) => {
    await deploy(
      dir,
      ['- domain: com.apple.dock', '  type: bool', '  value: true', ''].join(
        '\n',
      ),
    );
    const { context, calls } = recordingContext({
      home: dir,
      respond: () => ok(),
    });

    const report = await runActivation(applyDefaults(CONFIG_KEY), context);

    expect(report.status).toBe('failed');
    expect(report.error).toContain("'key' must be a non-empty string");
    expect(calls).toHaveLength(0);
  },
);

sandboxTest(
  'defaults manifest rejects values incompatible with the declared type',
  async (dir) => {
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
    const { context, calls } = recordingContext({
      home: dir,
      respond: () => ok(),
    });

    const report = await runActivation(applyDefaults(CONFIG_KEY), context);

    expect(report.status).toBe('failed');
    expect(report.error).toContain("'value' must be a boolean");
    expect(calls).toHaveLength(0);
  },
);
