import { expect } from 'bun:test';
import { readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { CommandResult } from '../../src/host/command';
import type { Context } from '../../src/host/context';
import { home } from '../../src/host/path';
import {
  remoteInstaller,
  runActivation,
} from '../../src/provisioning/activation';
import { emptyAssets } from '../fixtures/fake-context';
import { sandboxedTest } from '../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('remote-installer-');
const ok = (): CommandResult => ({ code: 0, stdout: '', stderr: '' });
const fail = (stderr = ''): CommandResult => ({ code: 1, stdout: '', stderr });

sandboxTest(
  'downloads with HTTPS-only curl and runs the temp installer',
  async (dir) => {
    const before = await installerTemps();
    const calls: { command: string; args: readonly string[] }[] = [];
    const context: Context = {
      home: dir,
      assets: emptyAssets,
      basePath: '',
      commands: {
        async run(command, args) {
          calls.push({ command, args });
          if (command === 'curl') {
            const output = args[args.indexOf('-o') + 1] as string;
            await writeFile(output, 'installer');
          }
          return ok();
        },
      },
    };

    const report = await runActivation(
      remoteInstaller({
        label: 'install demo',
        url: 'https://example.test/install.sh',
        interpreter: 'bash',
        args: ['--flag'],
        creates: home('.local/bin/demo'),
      }),
      context,
    );

    expect(report.status).toBe('changed');
    const output = calls[0]?.args[7];
    if (!output) throw new Error('expected curl output path');
    expect(calls[0]).toEqual({
      command: 'curl',
      args: [
        '--proto',
        '=https',
        '--proto-redir',
        '=https',
        '--tlsv1.2',
        '-fsSL',
        '-o',
        output,
        '--',
        'https://example.test/install.sh',
      ],
    });
    expect(calls[1]?.command).toBe('bash');
    expect(calls[1]?.args.slice(1)).toEqual(['--flag']);
    expect(await installerTemps()).toEqual(before);
  },
);

sandboxTest(
  'cleans the temporary installer after download failure',
  async (dir) => {
    const before = await installerTemps();
    const context: Context = {
      home: dir,
      assets: emptyAssets,
      basePath: '',
      commands: {
        async run(command) {
          return command === 'curl' ? fail('network down') : ok();
        },
      },
    };

    const report = await runActivation(
      remoteInstaller({
        label: 'install demo',
        url: 'https://example.test/install.sh',
        interpreter: 'bash',
        args: [],
        creates: home('.local/bin/demo'),
      }),
      context,
    );

    expect(report.status).toBe('failed');
    expect(report.error).toContain('network down');
    expect(await installerTemps()).toEqual(before);
  },
);

sandboxTest(
  'verifies checksum and runs a direct installer as executable',
  async (dir) => {
    const hash =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const calls: { command: string; args: readonly string[] }[] = [];
    const context: Context = {
      home: dir,
      assets: emptyAssets,
      basePath: '',
      commands: {
        async run(command, args) {
          calls.push({ command, args });
          if (command === 'curl') {
            const output = args[args.indexOf('-o') + 1] as string;
            await writeFile(
              output,
              args.at(-1)?.toString().endsWith('.sha256')
                ? `${hash}  rustup-init\n`
                : 'installer',
            );
          }
          if (command === 'shasum')
            return { code: 0, stdout: `${hash}  ${args[2]}\n`, stderr: '' };
          return ok();
        },
      },
    };

    const report = await runActivation(
      remoteInstaller({
        label: 'install demo',
        url: 'https://example.test/rustup-init',
        checksumUrl: 'https://example.test/rustup-init.sha256',
        interpreter: 'direct',
        args: ['-y'],
        creates: home('.cargo/bin/rustup'),
      }),
      context,
    );

    expect(report.status).toBe('changed');
    expect(calls.slice(0, 4).map((call) => call.command)).toEqual([
      'curl',
      'curl',
      'shasum',
      'chmod',
    ]);
    expect(calls[4]?.command).toContain('mev-installer-');
    expect(calls[4]?.args).toEqual(['-y']);
  },
);

sandboxTest('fails when checksum does not match', async (dir) => {
  const context: Context = {
    home: dir,
    assets: emptyAssets,
    basePath: '',
    commands: {
      async run(command, args) {
        if (command === 'curl') {
          const output = args[args.indexOf('-o') + 1] as string;
          await writeFile(
            output,
            args.at(-1)?.toString().endsWith('.sha256')
              ? 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff  install\n'
              : 'installer',
          );
        }
        if (command === 'shasum') {
          return {
            code: 0,
            stdout:
              '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  install\n',
            stderr: '',
          };
        }
        return ok();
      },
    },
  };

  const report = await runActivation(
    remoteInstaller({
      label: 'install demo',
      url: 'https://example.test/install',
      checksumUrl: 'https://example.test/install.sha256',
      interpreter: 'direct',
      args: [],
      creates: home('.local/bin/demo'),
    }),
    context,
  );

  expect(report.status).toBe('failed');
  expect(report.error).toContain('SHA256 mismatch');
});

async function installerTemps(): Promise<string[]> {
  return (await readdir(tmpdir()))
    .filter((name) => name.startsWith('mev-installer-'))
    .sort();
}
