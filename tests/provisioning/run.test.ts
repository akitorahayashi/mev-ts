import { expect } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { lstat, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deployedPath } from '../../src/assets/ref';
import { embeddedAssets } from '../../src/assets/registry';
import { CommandLineError, ProvisioningError } from '../../src/errors';
import { bunCommandRunner } from '../../src/host/command';
import type { Context } from '../../src/host/context';
import {
  appliedPath,
  readApplied,
  writeApplied,
} from '../../src/provisioning/applied';
import { deployRole } from '../../src/provisioning/deploy';
import { resolveTarget } from '../../src/provisioning/registry';
import { runMake } from '../../src/provisioning/run';
import { scanTargets } from '../../src/provisioning/scan';
import { targetSignature } from '../../src/provisioning/signature';
import { recordingContext } from '../fixtures/fake-context';
import { sandboxedTest } from '../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('run-');

// Real embedded assets, sandboxed home, and a brew runner that reports an
// empty inventory and successful installs, so the run exercises deploy +
// activation without touching Homebrew.
const contextFor = (homeDir: string): Context =>
  recordingContext({ home: homeDir, assets: embeddedAssets }).context;

function gitGroup(report: Awaited<ReturnType<typeof runMake>>) {
  return report.groups.find((g) => g.tag === 'git');
}

sandboxTest('an unknown tag is rejected', async (sandbox) => {
  await expect(
    runMake({ tags: ['nope'] }, contextFor(sandbox)),
  ).rejects.toBeInstanceOf(CommandLineError);
});

sandboxTest('apply deploys and links the git target', async (sandbox) => {
  const report = await runMake({ tags: ['git'] }, contextFor(sandbox));

  expect(report.failed).toBe(false);
  expect(report.deploys.some((d) => d.role === 'git' && d.deployed)).toBe(true);
  expect(gitGroup(report)?.reports.every((r) => r.status === 'changed')).toBe(
    true,
  );
  expect(await readApplied(appliedPath(sandbox, 'git'))).toBe(
    await targetSignature(resolveTarget('git'), embeddedAssets),
  );
});

sandboxTest(
  'git identity survives repeated provisioning from the managed XDG layout',
  async (sandbox) => {
    const context: Context = {
      ...contextFor(sandbox),
      commands: {
        async run(command, args, options) {
          if (command !== 'git') {
            return { code: 0, stdout: '', stderr: '' };
          }
          return bunCommandRunner.run(command, args, {
            ...options,
            env: {
              ...options?.env,
              HOME: sandbox,
              XDG_CONFIG_HOME: join(sandbox, '.config'),
            },
          });
        },
      },
    };
    await deployRole('git', context);

    const deployedConfig = deployedPath({ key: 'git/.gitconfig' }, sandbox);
    await writeFile(
      deployedConfig,
      `${await readFile(deployedConfig, 'utf8')}\n[user]\n\tname = Legacy Name\n\temail = legacy@example.com\n`,
    );
    const managedConfig = join(sandbox, '.config/git/config');
    await mkdir(join(managedConfig, '..'), { recursive: true });
    await symlink(deployedConfig, managedConfig);

    for (let run = 0; run < 2; run += 1) {
      const report = await runMake({ tags: ['git'] }, context);
      expect(report.failed).toBe(false);

      const name = await context.commands.run('git', [
        'config',
        '--global',
        '--get',
        'user.name',
      ]);
      const email = await context.commands.run('git', [
        'config',
        '--global',
        '--get',
        'user.email',
      ]);
      expect(name).toEqual({ code: 0, stdout: 'Legacy Name\n', stderr: '' });
      expect(email).toEqual({
        code: 0,
        stdout: 'legacy@example.com\n',
        stderr: '',
      });
    }

    const overlayStats = await lstat(join(sandbox, '.gitconfig'));
    expect(overlayStats.isFile()).toBe(true);
    expect(overlayStats.isSymbolicLink()).toBe(false);
    expect(await readFile(deployedConfig, 'utf8')).not.toContain('Legacy Name');
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

    await expect(runMake({ tags: ['git'] }, context)).rejects.toBeInstanceOf(
      ProvisioningError,
    );
    expect(await readApplied(marker)).toBe(existingSignature);
    expect(await readFile(deployedConfig, 'utf8')).toBe(
      'previous deployed content\n',
    );
  },
);

sandboxTest(
  'an alias and its tag select the same target once',
  async (sandbox) => {
    const report = await runMake(
      { tags: ['sh', 'shell'] },
      contextFor(sandbox),
    );
    expect(report.selection.tags).toEqual(['shell']);
  },
);

sandboxTest(
  'onDeploy fires for each role and onInstallStart reports formula count',
  async (sandbox) => {
    const deployed: string[] = [];
    let installTotal = -1;
    await runMake(
      {
        tags: ['git'],
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
        tags: ['git'],
        onActivationPhaseStart: (event) => {
          events.push(`phase:${event.totalTargets}`);
        },
        onActivationStart: (event) => {
          events.push(
            `start:${event.tag}:${event.activation.verb}:${event.activation.source}`,
          );
        },
        onActivationTargetComplete: (group) => {
          events.push(`complete:${group.tag}:${group.reports.length}`);
        },
      },
      contextFor(sandbox),
    );

    expect(report.failed).toBe(false);
    expect(events[0]).toBe('phase:1');
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
        tags: ['formulae'],
        onActivationPhaseStart: (event) => {
          events.push(`phase:${event.totalTargets}`);
        },
        onActivationStart: () => {
          events.push('start');
        },
        onActivationTargetComplete: (group) => {
          events.push(`complete:${group.tag}:${group.reports.length}`);
        },
      },
      contextFor(sandbox),
    );

    expect(report.failed).toBe(false);
    expect(events).toEqual(['phase:1', 'complete:formulae:0']);
    expect(await readApplied(appliedPath(sandbox, 'formulae'))).toBe(
      await targetSignature(resolveTarget('formulae'), embeddedAssets),
    );
  },
);

sandboxTest(
  'successful target completion is not reported before applied state is persisted',
  async (sandbox) => {
    const events: string[] = [];
    await expect(
      runMake(
        {
          tags: ['git'],
          onActivationPhaseStart: () => {
            events.push('phase');
          },
          onActivationStart: (event) => {
            events.push(`start:${event.tag}`);
            mkdirSync(appliedPath(sandbox, event.tag), { recursive: true });
          },
          onActivationTargetComplete: (group) => {
            events.push(`complete:${group.tag}`);
          },
        },
        contextFor(sandbox),
      ),
    ).rejects.toBeInstanceOf(ProvisioningError);

    expect(events[0]).toBe('phase');
    expect(events.some((event) => event === 'start:git')).toBe(true);
    expect(events.some((event) => event === 'complete:git')).toBe(false);
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

    await runMake({ tags: ['xcode'] }, context);

    expect(writes).toEqual(defaultsKeys);
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
        tags: ['git'],
        onActivationPhaseStart: () => events.push('phase'),
        onActivationTargetComplete: (entry) =>
          events.push(`complete:${entry.tag}`),
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
    expect((await scanTargets([python], context))[0]?.reasons).toEqual([
      'drift',
    ]);

    const report = await runMake({ tags: ['python'] }, context);
    const group = report.groups.find((entry) => entry.tag === 'python');

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
    expect((await scanTargets([python], context))[0]?.reasons).toEqual([
      'unapplied',
    ]);
  },
);
