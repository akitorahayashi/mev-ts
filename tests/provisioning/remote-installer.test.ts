import { expect } from 'bun:test';
import { mkdir, readdir, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AssetSource } from '../../src/assets/registry';
import { home } from '../../src/host/path';
import {
  remoteInstaller,
  runActivation,
} from '../../src/provisioning/activation';
import { fail, ok } from '../fixtures/fake-command-runner';
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

async function leakedWorkspaces(dir: string): Promise<string[]> {
  return (await readdir(dir))
    .filter((name) => name.startsWith('mev-installer-'))
    .sort();
}

async function createInstalledBinary(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, 'installed');
}

sandboxTest(
  'downloads with HTTPS-only curl and runs the temp installer',
  async (dir) => {
    const { context, calls } = installerContext(dir, async (command, args) => {
      if (command === 'curl') {
        const output = args[args.indexOf('-o') + 1] as string;
        await writeFile(output, 'installer');
      }
      if (command === 'bash') {
        await createInstalledBinary(join(dir, '.local/bin/demo'));
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
        env: {
          DEMO_INSTALL_DIR: { concat: [{ ref: 'home' }, '/.local/bin'] },
        },
        pathPrefix: [home('.local/bin')],
      }),
      context,
    );

    expect(report.status).toBe('changed');
    const curl = calls.find((call) => call.command === 'curl');
    const args = curl?.args ?? [];
    // Load-bearing transport contract: HTTPS-only on request and redirect, a TLS
    // floor, and the `--` guard immediately before the URL.
    expect(args).toContain('-sSL');
    expect(args).toContain('--fail-with-body');
    expect(args).toContain('--proto');
    expect(args).toContain('--proto-redir');
    expect(args).toContain('--tlsv1.2');
    expect(args.filter((arg) => arg === '=https')).toHaveLength(2);
    expect(args).toContain('-o');
    expect(args.at(-2)).toBe('--');
    expect(args.at(-1)).toBe('https://example.test/install.sh');
    expect(calls[1]?.command).toBe('bash');
    expect(calls[1]?.args.slice(1)).toEqual(['--flag']);
    expect(calls[1]?.options?.env).toEqual({
      DEMO_INSTALL_DIR: `${dir}/.local/bin`,
      PATH: `${dir}/.local/bin`,
    });
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
    if (command === 'bash') {
      await createInstalledBinary(join(dir, '.local/bin/demo'));
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

sandboxTest('reinstalls when creates is a dangling symlink', async (dir) => {
  const binDir = join(dir, '.local/bin');
  await mkdir(binDir, { recursive: true });
  await symlink('installed-demo', join(binDir, 'demo'));
  const { context, calls } = installerContext(dir, async (command, args) => {
    if (command === 'curl') {
      await writeFile(args[args.indexOf('-o') + 1] as string, 'installer');
    }
    if (command === 'bash') {
      await createInstalledBinary(join(binDir, 'installed-demo'));
    }
    return ok();
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
  expect(calls.map((call) => call.command)).toEqual(['curl', 'bash']);
});

sandboxTest(
  'fails when the installer exits zero without satisfying creates',
  async (dir) => {
    const { context } = installerContext(dir, async (command, args) => {
      if (command === 'curl') {
        await writeFile(args[args.indexOf('-o') + 1] as string, 'installer');
      }
      return ok();
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

    expect(report.status).toBe('failed');
    expect(report.error).toContain(
      'install demo completed without satisfying ~/.local/bin/demo',
    );
    expect(await leakedWorkspaces(dir)).toEqual([]);
  },
);

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
      if (command.includes('mev-installer-')) {
        await createInstalledBinary(join(dir, '.cargo/bin/rustup'));
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
    // Order matters: fetch installer, fetch checksum, verify, then run. The
    // execute bit is set through the filesystem, so it is not a subprocess.
    expect(calls.slice(0, 3).map((call) => call.command)).toEqual([
      'curl',
      'curl',
      'shasum',
    ]);
    expect(calls[3]?.command).toContain('mev-installer-');
    expect(calls[3]?.args).toEqual(['-y']);
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

sandboxTest(
  'a versioned installer resolves its args from reads and re-runs on a version change',
  async (dir) => {
    const assets: AssetSource = {
      ...emptyAssets,
      async read(key) {
        if (key === 'bun/.bun-version') return '1.2.3\n';
        throw new Error(`unexpected asset ${key}`);
      },
    };
    const activation = remoteInstaller({
      label: 'install demo',
      url: 'https://example.test/install',
      integrity: { acknowledgedUnverified: true },
      interpreter: 'bash',
      reads: { version: 'bun/.bun-version' },
      args: [{ concat: ['demo-v', { ref: 'version' }] }],
      creates: home('.demo/bin/demo'),
      skipIf: {
        commandOutputMatches: {
          argv: [{ concat: [{ ref: 'home' }, '/.demo/bin/demo'] }, '--version'],
          exact: { ref: 'version' },
        },
      },
    });

    let installedVersion = '1.0.0';
    const stale = recordingContext({
      home: dir,
      tmpRoot: dir,
      assets,
      async respond(command, args) {
        if (command === 'curl') {
          await writeFile(args[args.indexOf('-o') + 1] as string, 'installer');
          return ok();
        }
        if (command === 'bash') {
          installedVersion = '1.2.3';
          return ok();
        }
        return command.endsWith('/demo') ? ok(`${installedVersion}\n`) : ok();
      },
    });

    const report = await runActivation(activation, stale.context);

    expect(report.status).toBe('changed');
    const bash = stale.calls.find((call) => call.command === 'bash');
    // The version reaches the installer as a resolved argument, not as text
    // concatenated into a shell string.
    expect(bash?.args.slice(1)).toEqual(['demo-v1.2.3']);

    const current = recordingContext({
      home: dir,
      tmpRoot: dir,
      assets,
      respond: (command) => (command.endsWith('/demo') ? ok('1.2.3\n') : ok()),
    });

    expect((await runActivation(activation, current.context)).status).toBe(
      'unchanged',
    );
    expect(current.calls.map((call) => call.command)).toEqual([
      `${dir}/.demo/bin/demo`,
    ]);
  },
);

sandboxTest(
  'upgrade mode runs the declared updater only for an existing installation',
  async (dir) => {
    const binary = `${dir}/.local/bin/demo`;
    await mkdir(`${dir}/.local/bin`, { recursive: true });
    await writeFile(binary, 'installed');
    const activation = remoteInstaller({
      label: 'install demo',
      url: 'https://example.test/install',
      integrity: { acknowledgedUnverified: true },
      interpreter: 'bash',
      args: [],
      creates: home('.local/bin/demo'),
      upgrade: {
        label: 'demo update',
        argv: [{ concat: [{ ref: 'home' }, '/.local/bin/demo'] }, 'update'],
        versionProbe: [
          { concat: [{ ref: 'home' }, '/.local/bin/demo'] },
          '--version',
        ],
      },
    });
    const { context, calls } = installerContext(dir, (command, args) => {
      if (command !== binary) return ok();
      return args[0] === '--version'
        ? ok('demo 1.0.0\n')
        : ok('already up to date\n');
    });

    const routine = await runActivation(activation, context);
    const upgraded = await runActivation(activation, context, {
      upgrade: true,
    });

    expect(routine.status).toBe('unchanged');
    expect(upgraded.status).toBe('unchanged');
    expect(upgraded.entries).toEqual([
      {
        key: 'demo update',
        value: 'already latest (demo 1.0.0)',
        status: 'unchanged',
      },
    ]);
    expect(calls.map((call) => [call.command, ...call.args])).toEqual([
      [binary, '--version'],
      [binary, 'update'],
      [binary, '--version'],
    ]);
  },
);

sandboxTest(
  'upgrade mode reports a version change from independent probes',
  async (dir) => {
    const binary = `${dir}/.local/bin/demo`;
    await createInstalledBinary(binary);
    let version = 'demo 1.0.0';
    const { context } = installerContext(dir, (command, args) => {
      if (command !== binary) return ok();
      if (args[0] === '--version') return ok(`${version}\n`);
      version = 'demo 1.1.0';
      return ok('updated\n');
    });

    const report = await runActivation(
      remoteInstaller({
        label: 'install demo',
        url: 'https://example.test/install',
        integrity: { acknowledgedUnverified: true },
        interpreter: 'bash',
        args: [],
        creates: home('.local/bin/demo'),
        upgrade: {
          label: 'demo update',
          argv: [binary, 'update'],
          versionProbe: [binary, '--version'],
        },
      }),
      context,
      { upgrade: true },
    );

    expect(report.status).toBe('changed');
    expect(report.entries).toEqual([
      {
        key: 'demo update',
        value: 'demo 1.0.0 -> demo 1.1.0',
        status: 'changed',
      },
    ]);
  },
);

sandboxTest(
  'upgrade mode fails when the updated binary does not pass its version probe',
  async (dir) => {
    const binary = `${dir}/.local/bin/demo`;
    await createInstalledBinary(binary);
    let probes = 0;
    const { context } = installerContext(dir, (command, args) => {
      if (command !== binary || args[0] === 'update') return ok('updated\n');
      probes += 1;
      return probes === 1 ? ok('demo 1.0.0\n') : fail('binary broken');
    });

    const report = await runActivation(
      remoteInstaller({
        label: 'install demo',
        url: 'https://example.test/install',
        integrity: { acknowledgedUnverified: true },
        interpreter: 'bash',
        args: [],
        creates: home('.local/bin/demo'),
        upgrade: {
          label: 'demo update',
          argv: [binary, 'update'],
          versionProbe: [binary, '--version'],
        },
      }),
      context,
      { upgrade: true },
    );

    expect(report.status).toBe('failed');
    expect(report.entries?.[0]).toMatchObject({
      key: 'demo update',
      status: 'failed',
      error: 'demo update version probe failed with code 1: binary broken',
    });
  },
);

sandboxTest(
  'upgrade mode installs a missing tool without running its updater',
  async (dir) => {
    const binary = `${dir}/.local/bin/demo`;
    let installed = false;
    const { context, calls } = installerContext(dir, async (command, args) => {
      if (command === binary) {
        return installed ? ok('demo 1.0.0\n') : fail('demo unavailable');
      }
      if (command === 'curl') {
        const output = args[args.indexOf('-o') + 1] as string;
        await writeFile(output, 'installer');
      }
      if (command === 'bash') {
        await createInstalledBinary(binary);
        installed = true;
      }
      return ok();
    });
    const report = await runActivation(
      remoteInstaller({
        label: 'install demo',
        url: 'https://example.test/install',
        integrity: { acknowledgedUnverified: true },
        interpreter: 'bash',
        args: [],
        creates: home('.local/bin/demo'),
        upgrade: {
          label: 'demo update',
          argv: [binary, 'update'],
          versionProbe: [binary, '--version'],
        },
      }),
      context,
      { upgrade: true },
    );

    expect(report.status).toBe('changed');
    expect(calls.map((call) => call.command)).toEqual([binary, 'curl', 'bash']);
  },
);

sandboxTest(
  'a declared updater safety precondition blocks with its guidance',
  async (dir) => {
    const binary = `${dir}/.local/bin/demo`;
    await mkdir(`${dir}/.local/bin`, { recursive: true });
    await writeFile(binary, 'installed');
    const guidance = 'detach before updating demo';
    const { context } = installerContext(dir, (_command, args) =>
      args[0] === '--version'
        ? ok('demo 1.0.0\n')
        : fail(`update failed: ${guidance}`),
    );

    const report = await runActivation(
      remoteInstaller({
        label: 'install demo',
        url: 'https://example.test/install',
        integrity: { acknowledgedUnverified: true },
        interpreter: 'bash',
        args: [],
        creates: home('.local/bin/demo'),
        upgrade: {
          label: 'demo update',
          argv: [binary, 'update'],
          versionProbe: [binary, '--version'],
          blockedWhen: { errorContains: guidance },
        },
      }),
      context,
      { upgrade: true },
    );

    expect(report).toMatchObject({
      status: 'blocked',
      error: `update failed: ${guidance}`,
    });
    expect(report.entries).toBeUndefined();
  },
);
