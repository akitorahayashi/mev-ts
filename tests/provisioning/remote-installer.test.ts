import { expect } from 'bun:test';
import { readdir, writeFile } from 'node:fs/promises';
import { home } from '../../src/host/path';
import {
  remoteInstaller,
  runActivation,
} from '../../src/provisioning/activation';
import { emptyAssets, recordingContext } from '../fixtures/fake-context';
import { sandboxedTest } from '../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('remote-installer-');

// Confine installer scratch to the sandbox so the assertion never reads the
// real system temp directory (no cross-run or concurrency coupling).
function installerContext(
  dir: string,
  respond: Parameters<typeof recordingContext>[0]['respond'],
) {
  return recordingContext({
    home: dir,
    assets: emptyAssets,
    tmpRoot: dir,
    respond,
  });
}

/** Installer workspaces leaked inside the sandbox, if any. */
async function leakedWorkspaces(dir: string): Promise<string[]> {
  return (await readdir(dir))
    .filter((name) => name.startsWith('mev-installer-'))
    .sort();
}

sandboxTest(
  'downloads with HTTPS-only curl and runs the temp installer',
  async (dir) => {
    const { context, calls } = installerContext(dir, async (command, args) => {
      if (command === 'curl') {
        const output = args[args.indexOf('-o') + 1] as string;
        await writeFile(output, 'installer');
      }
      return { code: 0, stdout: '', stderr: '' };
    });

    const report = await runActivation(
      remoteInstaller({
        label: 'install demo',
        url: 'https://example.test/install.sh',
        integrity: { acknowledgedUnverified: true },
        interpreter: 'bash',
        args: ['--flag'],
        creates: home('.local/bin/demo'),
      }),
      context,
    );

    expect(report.status).toBe('changed');
    const curl = calls.find((call) => call.command === 'curl');
    const args = curl?.args ?? [];
    // Load-bearing transport contract: HTTPS-only on request and redirect, a TLS
    // floor, and the `--` guard immediately before the URL.
    expect(args).toContain('-fsSL');
    expect(args).toContain('--proto');
    expect(args).toContain('--proto-redir');
    expect(args).toContain('--tlsv1.2');
    expect(args.filter((arg) => arg === '=https')).toHaveLength(2);
    expect(args).toContain('-o');
    expect(args.at(-2)).toBe('--');
    expect(args.at(-1)).toBe('https://example.test/install.sh');
    expect(calls[1]?.command).toBe('bash');
    expect(calls[1]?.args.slice(1)).toEqual(['--flag']);
    expect(await leakedWorkspaces(dir)).toEqual([]);
  },
);

sandboxTest(
  'cleans the temporary installer after download failure',
  async (dir) => {
    const { context } = installerContext(dir, (command) =>
      command === 'curl'
        ? { code: 1, stdout: '', stderr: 'network down' }
        : { code: 0, stdout: '', stderr: '' },
    );

    const report = await runActivation(
      remoteInstaller({
        label: 'install demo',
        url: 'https://example.test/install.sh',
        integrity: { acknowledgedUnverified: true },
        interpreter: 'bash',
        args: [],
        creates: home('.local/bin/demo'),
      }),
      context,
    );

    expect(report.status).toBe('failed');
    expect(report.error).toContain('network down');
    expect(await leakedWorkspaces(dir)).toEqual([]);
  },
);

sandboxTest('acknowledgedUnverified runs no integrity check', async (dir) => {
  const commands: string[] = [];
  const { context } = installerContext(dir, async (command, args) => {
    commands.push(command);
    if (command === 'curl') {
      const output = args[args.indexOf('-o') + 1] as string;
      await writeFile(output, 'installer');
    }
    return { code: 0, stdout: '', stderr: '' };
  });

  const report = await runActivation(
    remoteInstaller({
      label: 'install demo',
      url: 'https://example.test/install.sh',
      integrity: { acknowledgedUnverified: true },
      interpreter: 'bash',
      args: [],
      creates: home('.local/bin/demo'),
    }),
    context,
  );

  expect(report.status).toBe('changed');
  // The unverified branch downloads only the installer (one curl) and never
  // runs a checksum download or shasum.
  expect(commands.filter((command) => command === 'curl')).toHaveLength(1);
  expect(commands).not.toContain('shasum');
});

sandboxTest(
  'verifies checksum and runs a direct installer as executable',
  async (dir) => {
    const hash =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const { context, calls } = installerContext(dir, async (command, args) => {
      if (command === 'curl') {
        const output = args[args.indexOf('-o') + 1] as string;
        await writeFile(
          output,
          args.at(-1)?.toString().endsWith('.sha256')
            ? `${hash}  rustup-init\n`
            : 'installer',
        );
      }
      if (command === 'shasum') {
        return { code: 0, stdout: `${hash}  ${args[2]}\n`, stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    });

    const report = await runActivation(
      remoteInstaller({
        label: 'install demo',
        url: 'https://example.test/rustup-init',
        integrity: { checksumUrl: 'https://example.test/rustup-init.sha256' },
        interpreter: 'direct',
        args: ['-y'],
        creates: home('.cargo/bin/rustup'),
      }),
      context,
    );

    expect(report.status).toBe('changed');
    // Order matters: fetch installer, fetch checksum, verify, mark executable,
    // then run.
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
  const { context } = installerContext(dir, async (command, args) => {
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
    return { code: 0, stdout: '', stderr: '' };
  });

  const report = await runActivation(
    remoteInstaller({
      label: 'install demo',
      url: 'https://example.test/install',
      integrity: { checksumUrl: 'https://example.test/install.sha256' },
      interpreter: 'direct',
      args: [],
      creates: home('.local/bin/demo'),
    }),
    context,
  );

  expect(report.status).toBe('failed');
  expect(report.error).toContain('SHA256 mismatch');
});
