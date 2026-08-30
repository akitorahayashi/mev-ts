import { expect } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { lstat, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deployedPath } from '../../src/assets/ref';
import { embeddedAssets } from '../../src/assets/registry';
import { AppError, CommandLineError } from '../../src/errors';
import type { Context } from '../../src/host/context';
import {
  appliedPath,
  readApplied,
  writeApplied,
} from '../../src/provisioning/applied';
import { deployRole } from '../../src/provisioning/deploy';
import { groupStatus } from '../../src/provisioning/group-outcome';
import { resolveTarget } from '../../src/provisioning/registry';
import { runMake } from '../../src/provisioning/run';
import { isScanError, scanTargets } from '../../src/provisioning/scan';
import { targetSignature } from '../../src/provisioning/signature';
import { ok } from '../fixtures/fake-command-runner';
import { recordingContext } from '../fixtures/fake-context';
import { sandboxedTest } from '../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('run-');

// Real embedded assets, sandboxed home, and a brew runner that reports an
// empty inventory and successful installs, so the run exercises deploy +
// activation without touching Homebrew.
const contextFor = (homeDir: string): Context =>
  recordingContext({ home: homeDir, assets: embeddedAssets }).context;

function gitGroup(report: Awaited<ReturnType<typeof runMake>>) {
  return report.groups.find((group) => group.targetName === 'git');
}

sandboxTest('an unknown tag is rejected', async (sandbox) => {
  await expect(
    runMake({ selectors: ['nope'] }, contextFor(sandbox)),
  ).rejects.toBeInstanceOf(CommandLineError);
});

sandboxTest('apply deploys and links the git target', async (sandbox) => {
  const report = await runMake({ selectors: ['git'] }, contextFor(sandbox));

  expect(report.failed).toBe(false);
  expect(report.deploys.some((d) => d.role === 'git' && d.deployed)).toBe(true);
  expect(gitGroup(report)?.reports.every((r) => r.status === 'changed')).toBe(
    true,
  );
  expect(await readApplied(appliedPath(sandbox, 'git'))).toBe(
    await targetSignature(resolveTarget('git'), embeddedAssets),
  );
});

/**
 * A git that answers only the `config` reads the identity overlay performs, from
 * an in-memory store keyed by config file. Writes land in the store, so repeated
 * provisioning observes what the previous run recorded — the property under test
 * — without requiring a real git or XDG semantics inside an otherwise hermetic
 * suite.
 */
function fakeGit(sandbox: string, globalValues: Record<string, string>) {
  const files = new Map<string, Map<string, string>>();
  const overlay = join(sandbox, '.gitconfig');
  const run: Context['commands'] = {
    async run(command, args) {
      if (command !== 'git' || args[0] !== 'config') {
        return { code: 0, stdout: '', stderr: '' };
      }
      if (args[1] === '--global' && args[2] === '--get') {
        const value = globalValues[args[3] ?? ''];
        return value === undefined
          ? { code: 1, stdout: '', stderr: '' }
          : { code: 0, stdout: `${value}\n`, stderr: '' };
      }
      if (args[1] === '--file' && args[3] === '--get') {
        const value = files.get(args[2] ?? '')?.get(args[4] ?? '');
        return value === undefined
          ? { code: 1, stdout: '', stderr: '' }
          : { code: 0, stdout: `${value}\n`, stderr: '' };
      }
      if (args[1] === '--file' && args[4] !== undefined) {
        const path = args[2] ?? '';
        const entries = files.get(path) ?? new Map<string, string>();
        entries.set(args[3] ?? '', args[4]);
        files.set(path, entries);
        // The staging file is renamed onto the overlay, so the values written
        // through it become the overlay's on the next read.
        files.set(overlay, entries);
        return { code: 0, stdout: '', stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    },
  };
  return { run, overlayValues: () => files.get(overlay) };
}

sandboxTest(
  'git identity survives repeated provisioning from the managed XDG layout',
  async (sandbox) => {
    const git = fakeGit(sandbox, {
      'user.name': 'Legacy Name',
      'user.email': 'legacy@example.com',
    });
    const context: Context = { ...contextFor(sandbox), commands: git.run };
    await deployRole('git', context);

    const managedConfig = join(sandbox, '.config/git/config');
    await mkdir(join(managedConfig, '..'), { recursive: true });
    await symlink(
      deployedPath({ key: 'git/.gitconfig' }, sandbox),
      managedConfig,
    );

    for (let run = 0; run < 2; run += 1) {
      const report = await runMake({ selectors: ['git'] }, context);
      expect(report.failed).toBe(false);
    }

    // The identity moved into the mutable overlay, which is a regular file the
    // deploy phase never replaces, and stayed there across the second run.
    expect(Object.fromEntries(git.overlayValues() ?? [])).toEqual({
      'user.name': 'Legacy Name',
      'user.email': 'legacy@example.com',
    });
    const overlayStats = await lstat(join(sandbox, '.gitconfig'));
    expect(overlayStats.isFile()).toBe(true);
    expect(overlayStats.isSymbolicLink()).toBe(false);
  },
);

sandboxTest(
  'a git identity preservation failure stops before invalidation and deploy',
  async (sandbox) => {
    const managedConfig = join(sandbox, '.config/git/config');
    await mkdir(join(managedConfig, '..'), { recursive: true });
    await writeFile(managedConfig, '[user]\n\tname = Legacy Name\n');

    const marker = appliedPath(sandbox, 'git');
    const existingSignature = `sha256:${'a'.repeat(64)}`;
    await writeApplied(marker, existingSignature);
    const deployedConfig = deployedPath({ key: 'git/.gitconfig' }, sandbox);
    await mkdir(join(deployedConfig, '..'), { recursive: true });
    await writeFile(deployedConfig, 'previous deployed content\n');

    const context = recordingContext({
      home: sandbox,
      assets: embeddedAssets,
      respond(command) {
        return command === 'git'
          ? { code: 127, stdout: '', stderr: 'git unavailable' }
          : { code: 0, stdout: '', stderr: '' };
      },
    }).context;

    await expect(
      runMake({ selectors: ['git'] }, context),
    ).rejects.toBeInstanceOf(AppError);
    expect(await readApplied(marker)).toBe(existingSignature);
    expect(await readFile(deployedConfig, 'utf8')).toBe(
      'previous deployed content\n',
    );
  },
);

sandboxTest(
  'app-written state under a legacy link survives the deploy that follows',
  async (sandbox) => {
    // The pre-merge layout, which every already-provisioned machine carries: the
    // app's config path is a link into the deploy store, so what the app wrote at
    // runtime lives in the role file the deploy phase is about to replace. No
    // target declares this path — the protection comes from the activation kind.
    const storePath = deployedPath({ key: 'vscode/settings.json' }, sandbox);
    const hostPath = join(
      sandbox,
      'Library/Application Support/Code/User/settings.json',
    );
    mkdirSync(join(storePath, '..'), { recursive: true });
    // A key no embedded asset declares, so only preservation can keep it.
    await writeFile(storePath, '{"mev.test.appOwnedKey": 15}\n');
    mkdirSync(join(hostPath, '..'), { recursive: true });
    await symlink(storePath, hostPath);

    const report = await runMake(
      { selectors: ['vscode'] },
      contextFor(sandbox),
    );

    expect(report.failed).toBe(false);
    const stats = await lstat(hostPath);
    expect(stats.isSymbolicLink()).toBe(false);
    const written = JSON.parse(await readFile(hostPath, 'utf8'));
    expect(written['mev.test.appOwnedKey']).toBe(15);
    // The deploy reset the role file, so preservation is the only reason the key
    // is still here.
    expect(await readFile(storePath, 'utf8')).not.toContain('appOwnedKey');
  },
);

sandboxTest(
  'an alias and its tag select the same target once',
  async (sandbox) => {
    const report = await runMake(
      { selectors: ['sh', 'shell'] },
      contextFor(sandbox),
    );
    expect(report.selection.targetNames).toEqual(['shell']);
  },
);

sandboxTest(
  'onDeploy fires for each role and onInstallStart reports formula count',
  async (sandbox) => {
    const deployed: string[] = [];
    let installTotal = -1;
    await runMake(
      {
        selectors: ['git'],
        onDeploy: (r) => deployed.push(r.role),
        onInstallStart: (n) => {
          installTotal = n;
        },
      },
      contextFor(sandbox),
    );
    expect(deployed).toEqual(['git']);
    expect(installTotal).toBe(1);
  },
);

sandboxTest(
  'activation hooks report phase progress in order',
  async (sandbox) => {
    const events: string[] = [];
    const report = await runMake(
      {
        selectors: ['git'],
        onActivationPhaseStart: () => {
          events.push('phase');
        },
        onActivationStart: (event) => {
          events.push(
            `start:${event.targetName}:${event.activation.verb}:${event.activation.source}`,
          );
        },
        onActivationTargetComplete: (group) => {
          events.push(`complete:${group.targetName}:${group.reports.length}`);
        },
      },
      contextFor(sandbox),
    );

    expect(report.failed).toBe(false);
    expect(events[0]).toBe('phase');
    expect(events.some((event) => event.startsWith('start:git:'))).toBe(true);
    expect(events.at(-1)).toBe(
      `complete:git:${gitGroup(report)?.reports.length}`,
    );
  },
);

sandboxTest(
  'empty activation targets still complete the progress lifecycle',
  async (sandbox) => {
    const events: string[] = [];
    const report = await runMake(
      {
        selectors: ['formulae'],
        onActivationPhaseStart: () => {
          events.push('phase');
        },
        onActivationStart: () => {
          events.push('start');
        },
        onActivationTargetComplete: (group) => {
          events.push(`complete:${group.targetName}:${group.reports.length}`);
        },
      },
      contextFor(sandbox),
    );

    expect(report.failed).toBe(false);
    expect(events).toEqual(['phase', 'complete:formulae:0']);
    expect(await readApplied(appliedPath(sandbox, 'formulae'))).toBe(
      await targetSignature(resolveTarget('formulae'), embeddedAssets),
    );
  },
);

sandboxTest(
  'a marker-write failure is isolated so later targets still activate',
  async (sandbox) => {
    const selectors = ['git', 'shell'];
    let firstTarget: string | undefined;
    const completed: string[] = [];

    const report = await runMake(
      {
        selectors,
        onActivationStart: (event) => {
          if (firstTarget === undefined) firstTarget = event.targetName;
          // Turn the first target's marker path into a directory so its
          // writeApplied fails after its activations have already succeeded.
          if (event.targetName === firstTarget) {
            mkdirSync(appliedPath(sandbox, firstTarget), { recursive: true });
          }
        },
        onActivationTargetComplete: (group) => completed.push(group.targetName),
      },
      contextFor(sandbox),
    );

    const secondName = selectors.find((name) => name !== firstTarget) as string;
    const firstGroup = report.groups.find((g) => g.targetName === firstTarget);
    const secondGroup = report.groups.find((g) => g.targetName === secondName);

    // The first target activated cleanly but could not record its marker.
    expect(firstGroup?.reports.every((r) => r.status === 'changed')).toBe(true);
    expect(firstGroup?.markerError).toContain(
      'Failed to write applied signature',
    );

    // The run did not abort: the second target still activated and recorded.
    expect(completed).toContain(secondName);
    expect(secondGroup?.markerError).toBeUndefined();
    expect(await readApplied(appliedPath(sandbox, secondName))).toBe(
      await targetSignature(resolveTarget(secondName), embeddedAssets),
    );

    // The marker failure is surfaced rather than swallowed.
    expect(report.failed).toBe(true);
  },
);

sandboxTest(
  'activations in one target run in declaration order',
  async (sandbox) => {
    const defaultsKeys = [
      'BehaviorOrder',
      'BuildOrder',
      'EditorOrder',
      'UiOrder',
    ];
    const assetKeys = [
      'xcode/behavior.yml',
      'xcode/build.yml',
      'xcode/editor.yml',
      'xcode/ui.yml',
    ];
    const assets = new Map(
      assetKeys.map((key, index) => [
        key,
        `---
- key: ${defaultsKeys[index]}
  type: bool
  value: true
  domain: com.apple.dt.Xcode
`,
      ]),
    );
    const writes: string[] = [];
    const context: Context = {
      ...contextFor(sandbox),
      assets: {
        async read(key) {
          const content = assets.get(key);
          if (content === undefined) throw new Error(`unexpected asset ${key}`);
          return content;
        },
        keysByPrefix(prefix) {
          return assetKeys.filter((key) => key.startsWith(prefix));
        },
        isExecutable() {
          return false;
        },
      },
      commands: {
        async run(command, args) {
          if (command === 'defaults' && args[0] === 'write') {
            const key = args[2] ?? '';
            if (key === 'BehaviorOrder') {
              await new Promise((resolve) => setTimeout(resolve, 20));
            }
            writes.push(key);
          }
          return { code: 0, stdout: '', stderr: '' };
        },
      },
    };

    await runMake({ selectors: ['xcode'] }, context);

    expect(writes).toEqual(defaultsKeys);
  },
);

sandboxTest(
  'an unhealthy CLI is reinstalled and blocks later activations if still unhealthy',
  async (sandbox) => {
    const binDir = join(sandbox, '.local/bin');
    await mkdir(binDir, { recursive: true });
    await writeFile(join(binDir, 'claude'), 'installed');
    await symlink('missing-codex', join(binDir, 'codex'));
    const started: string[] = [];
    const { context, calls } = recordingContext({
      home: sandbox,
      assets: embeddedAssets,
      async respond(command, args) {
        if (command === join(binDir, 'codex')) {
          return { code: 127, stdout: '', stderr: 'codex unavailable' };
        }
        if (command === 'curl') {
          await writeFile(args[args.indexOf('-o') + 1] as string, 'installer');
        }
        return { code: 0, stdout: '', stderr: '' };
      },
    });

    const report = await runMake(
      {
        selectors: ['coder'],
        onActivationStart: ({ activation }) => {
          started.push(activation.source);
        },
      },
      context,
    );
    const group = report.groups.find(
      ({ targetName }) => targetName === 'coder',
    );

    expect(report.failed).toBe(true);
    expect(group && groupStatus(group)).toBe('failed');
    expect(started).toEqual(['install claude', 'install codex']);
    expect(group?.reports[0]?.status).toBe('unchanged');
    expect(group?.reports[1]).toMatchObject({
      source: 'install codex',
      status: 'failed',
      error:
        'install codex completed without satisfying its declared post-install guard.',
    });
    expect(
      group?.reports.slice(2).every(({ status }) => status === 'blocked'),
    ).toBe(true);
    expect(calls.some(({ command }) => command === 'codex')).toBe(false);
    expect(
      calls.filter(({ command }) => command === join(binDir, 'codex')),
    ).toHaveLength(2);
    expect(calls.some(({ command }) => command === 'sh')).toBe(true);
  },
);

sandboxTest(
  'upgrade mode updates healthy coder CLIs before plugin reconciliation',
  async (sandbox) => {
    const binDir = join(sandbox, '.local/bin');
    const claude = join(binDir, 'claude');
    const codex = join(binDir, 'codex');
    await mkdir(binDir, { recursive: true });
    await writeFile(claude, 'installed');
    await writeFile(codex, 'installed');
    let claudeVersion = '2.1.0 (Claude Code)';
    let codexVersion = 'codex-cli 0.150.0';
    const assets: Context['assets'] = {
      read: (key) =>
        key === 'coder/plugins.yml'
          ? Promise.resolve('marketplaces: []\n')
          : embeddedAssets.read(key),
      keysByPrefix: (prefix) => embeddedAssets.keysByPrefix(prefix),
      isExecutable: (key) => embeddedAssets.isExecutable(key),
    };
    const { context, calls } = recordingContext({
      home: sandbox,
      assets,
      respond(command, args) {
        if (command === claude) {
          if (args[0] === '--version') return ok(`${claudeVersion}\n`);
          claudeVersion = '2.2.0 (Claude Code)';
          return ok('updated\n');
        }
        if (command === codex) {
          if (args[0] === '--version') return ok(`${codexVersion}\n`);
          codexVersion = 'codex-cli 0.151.0';
          return ok('updated\n');
        }
        if (command === 'brew' && args[0] === '--prefix') {
          return ok('/opt/homebrew\n');
        }
        return ok();
      },
    });

    const report = await runMake(
      { selectors: ['coder'], upgrade: true },
      context,
    );
    const group = report.groups.find(
      ({ targetName }) => targetName === 'coder',
    );

    expect(report.failed).toBe(false);
    expect(
      calls
        .filter(({ command }) => command === claude || command === codex)
        .map(({ command, args }) => [command, ...args]),
    ).toEqual([
      [claude, '--version'],
      [claude, 'update'],
      [claude, '--version'],
      [codex, '--version'],
      [codex, 'update'],
      [codex, '--version'],
    ]);
    expect(group?.reports[0]?.entries?.[0]).toMatchObject({
      value: '2.1.0 (Claude Code) -> 2.2.0 (Claude Code)',
      status: 'changed',
    });
    expect(group?.reports[1]?.entries?.[0]).toMatchObject({
      value: 'codex-cli 0.150.0 -> codex-cli 0.151.0',
      status: 'changed',
    });
  },
);

sandboxTest(
  'a failed role deploy blocks its group activations',
  async (sandbox) => {
    const events: string[] = [];
    const context: Context = {
      ...contextFor(sandbox),
      assets: {
        read: (key) =>
          key.startsWith('git/')
            ? Promise.reject(new Error('deploy boom'))
            : embeddedAssets.read(key),
        keysByPrefix: (prefix) => embeddedAssets.keysByPrefix(prefix),
        isExecutable: (key) => embeddedAssets.isExecutable(key),
      },
    };

    const report = await runMake(
      {
        selectors: ['git'],
        onActivationPhaseStart: () => events.push('phase'),
        onActivationTargetComplete: (entry) =>
          events.push(`complete:${entry.targetName}`),
      },
      context,
    );
    const group = gitGroup(report);

    expect(report.failed).toBe(true);
    const deploy = report.deploys.find((d) => d.role === 'git');
    expect(deploy?.deployed).toBe(false);
    expect(deploy?.error).toContain('deploy boom');
    expect(group?.blockers).toContainEqual(
      expect.objectContaining({ kind: 'deploy', role: 'git' }),
    );
    expect(group?.reports.length).toBeGreaterThan(0);
    expect(group?.reports.every((entry) => entry.status === 'blocked')).toBe(
      true,
    );
    expect(events).toEqual(['phase', 'complete:git']);
  },
);

sandboxTest(
  'upgrade mode upgrades selected installed Homebrew packages before activation',
  async (sandbox) => {
    const { context, calls } = recordingContext({
      home: sandbox,
      assets: embeddedAssets,
      respond(command, args) {
        if (command !== 'brew') return ok();
        if (args[0] === 'list') return ok('gh\n');
        return ok();
      },
    });

    const report = await runMake({ selectors: ['gh'], upgrade: true }, context);

    expect(report.failed).toBe(false);
    expect(
      calls.filter((call) => call.command === 'brew').map((call) => call.args),
    ).toContainEqual(['upgrade', '--formula', 'gh']);
    expect(
      calls.some(
        (call) => call.command === 'brew' && call.args[0] === 'update',
      ),
    ).toBe(false);
  },
);

sandboxTest(
  'a failed package blocks dependent activations',
  async (sandbox) => {
    const commands: string[] = [];
    const context: Context = {
      ...contextFor(sandbox),
      commands: {
        async run(command, args) {
          commands.push([command, ...args].join(' '));
          if (command !== 'brew') {
            return { code: 0, stdout: '', stderr: '' };
          }
          const fileArg = args.find((arg) => arg.startsWith('--file='));
          if (!fileArg) {
            // Enumeration probes report nothing installed.
            return { code: 0, stdout: '', stderr: '' };
          }
          const brewfile = await Bun.file(
            fileArg.slice('--file='.length),
          ).text();
          if (args.includes('install') && brewfile.includes('brew "uv"')) {
            return { code: 1, stdout: '', stderr: 'uv unavailable' };
          }
          return { code: 0, stdout: '', stderr: '' };
        },
      },
    };

    const python = resolveTarget('python');
    const marker = appliedPath(sandbox, python.name);
    await deployRole(python.role, context);
    await writeApplied(marker, await targetSignature(python, embeddedAssets));
    const driftedKey = embeddedAssets.keysByPrefix(`${python.role}/`)[0];
    if (!driftedKey) throw new Error('python target has no embedded assets');
    await writeFile(deployedPath({ key: driftedKey }, sandbox), 'drift\n');
    const driftScan = (await scanTargets([python], context))[0];
    expect(
      driftScan && !isScanError(driftScan) ? driftScan.reasons : null,
    ).toEqual(['drift']);

    const report = await runMake({ selectors: ['python'] }, context);
    const group = report.groups.find((entry) => entry.targetName === 'python');

    expect(report.failed).toBe(true);
    expect(report.install).toContainEqual({
      token: { kind: 'formula', name: 'uv' },
      status: 'failed',
      error: 'brew bundle install failed for uv with code 1: uv unavailable',
    });
    expect(group?.blockers).toEqual([
      {
        kind: 'package',
        token: { kind: 'formula', name: 'uv' },
        error: 'brew bundle install failed for uv with code 1: uv unavailable',
      },
    ]);
    expect(group?.reports.every((entry) => entry.status === 'blocked')).toBe(
      true,
    );
    expect(commands.some((command) => command === 'brew --prefix')).toBe(false);
    expect(await readApplied(marker)).toBeNull();
    const unappliedScan = (await scanTargets([python], context))[0];
    expect(
      unappliedScan && !isScanError(unappliedScan)
        ? unappliedScan.reasons
        : null,
    ).toEqual(['unapplied']);
  },
);
