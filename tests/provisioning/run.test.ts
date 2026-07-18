import { expect } from 'bun:test';
import { embeddedAssets } from '../../src/assets/registry';
import { CommandLineError } from '../../src/errors';
import type { Context } from '../../src/host/context';
import { runMake } from '../../src/provisioning/run';
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
});

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
  'activations in one target run in declaration order',
  async (sandbox) => {
    const defaultsKeys = [
      'BehaviorOrder',
      'BuildOrder',
      'EditorOrder',
      'UiOrder',
    ];
    const assetKeys = [
      'xcode/global/behavior.yml',
      'xcode/global/build.yml',
      'xcode/global/editor.yml',
      'xcode/global/ui.yml',
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

    const report = await runMake({ tags: ['git'] }, context);
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
  },
);
