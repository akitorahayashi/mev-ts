import { expect } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CommandResult } from '../../src/host/command';
import { applyPipx, runActivation } from '../../src/provisioning/activation';
import { fail, ok } from '../fixtures/fake-command-runner';
import { recordingContext } from '../fixtures/fake-context';
import { sandboxedTest } from '../fixtures/temporary-directory';

const CONFIG_KEY = 'pipx/tools.yml';

const YAML = `
tools:
  yt-dlp: latest
  browser-tool:
    version: 1.0.0
    inject:
      - browser-driver
    post_install:
      bin: browser-tool
      args: [setup]
`.trimStart();

const sandboxTest = sandboxedTest('pipx-');

async function deployConfig(dir: string, yaml: string = YAML): Promise<void> {
  const roleDir = join(dir, '.mev', 'roles', 'pipx');
  await mkdir(roleDir, { recursive: true });
  await writeFile(join(roleDir, 'tools.yml'), yaml);
}

const PREFIX = '/opt/homebrew';

function listJson(
  venvs: Record<
    string,
    {
      package: string;
      package_version: string;
      deps?: string[];
    }
  >,
): string {
  const out: Record<string, unknown> = {};
  for (const [name, v] of Object.entries(venvs)) {
    out[name] = {
      metadata: {
        main_package: {
          package: v.package,
          package_version: v.package_version,
          app_paths_of_dependencies: Object.fromEntries(
            (v.deps ?? []).map((d) => [d, []]),
          ),
        },
      },
    };
  }
  return JSON.stringify({ venvs: out });
}

const VENVS = '/opt/pipx/venvs';

function baseResponder(listOutput: string) {
  return (cmd: string, args: readonly string[]): CommandResult => {
    if (cmd === 'brew' && args[0] === '--prefix') return ok(PREFIX);
    if (cmd === 'pipx' && args[0] === 'list') return ok(listOutput);
    if (cmd === 'pipx' && args[0] === 'environment') return ok(VENVS);
    return ok('installed package');
  };
}

sandboxTest(
  'all tools current: no install/inject/post-install runs',
  async (dir) => {
    await deployConfig(dir);
    const listed = listJson({
      'yt-dlp': {
        package: 'yt-dlp',
        package_version: '1.0',
      },
      'browser-tool': {
        package: 'browser-tool',
        package_version: '1.0.0',
        deps: ['browser-driver'],
      },
    });
    const { context, calls } = recordingContext({
      home: dir,
      respond: baseResponder(listed),
    });

    const report = await runActivation(applyPipx(CONFIG_KEY), context);

    expect(report.status).toBe('unchanged');
    expect(calls.some((c) => c.args[0] === 'install')).toBe(false);
    expect(calls.some((c) => c.args[0] === 'inject')).toBe(false);
  },
);

sandboxTest(
  'fresh install runs install, inject, then post-install in order',
  async (dir) => {
    await deployConfig(dir);
    const { context, calls } = recordingContext({
      home: dir,
      respond: baseResponder(listJson({})),
    });

    const report = await runActivation(applyPipx(CONFIG_KEY), context);

    expect(report.status).toBe('changed');
    const browserToolCalls = calls.filter(
      (c) =>
        c.args.some((a) => a.includes('browser-tool')) ||
        c.command.includes('/browser-tool/'),
    );
    const verbs = browserToolCalls.map((c) =>
      c.command.endsWith('browser-tool') ? 'post' : c.args[0],
    );
    expect(verbs).toEqual(['install', 'inject', 'post']);
    const post = calls.find((c) => c.command.endsWith('browser-tool'));
    expect(post?.command).toBe(
      join(VENVS, 'browser-tool', 'bin', 'browser-tool'),
    );
    expect(post?.args).toEqual(['setup']);
  },
);

sandboxTest(
  'version mismatch triggers uninstall before install',
  async (dir) => {
    await deployConfig(dir);
    const listed = listJson({
      'browser-tool': {
        package: 'browser-tool',
        package_version: '0.9.0',
        deps: ['browser-driver'],
      },
      'yt-dlp': {
        package: 'yt-dlp',
        package_version: '1.0',
      },
    });
    const { context, calls } = recordingContext({
      home: dir,
      respond: baseResponder(listed),
    });

    await runActivation(applyPipx(CONFIG_KEY), context);

    const browserTool = calls.filter((c) =>
      c.args.some((a) => a.includes('browser-tool')),
    );
    expect(browserTool.map((c) => c.args[0])).toEqual([
      'uninstall',
      'install',
      'inject',
    ]);
  },
);

sandboxTest(
  'upgrade mode upgrades latest-declared installed tools and skips pinned ones',
  async (dir) => {
    await deployConfig(dir);
    let ytdlpVersion = '1.0';
    const currentList = () =>
      listJson({
        'yt-dlp': {
          package: 'yt-dlp',
          package_version: ytdlpVersion,
        },
        'browser-tool': {
          package: 'browser-tool',
          package_version: '1.0.0',
          deps: ['browser-driver'],
        },
      });
    const { context, calls } = recordingContext({
      home: dir,
      respond: (cmd, args) => {
        if (cmd === 'pipx' && args[0] === 'upgrade') {
          ytdlpVersion = '2.0';
          return ok();
        }
        return baseResponder(currentList())(cmd, args);
      },
    });

    const report = await runActivation(applyPipx(CONFIG_KEY), context, {
      upgrade: true,
    });

    expect(report.status).toBe('changed');
    const upgrades = calls.filter((c) => c.args[0] === 'upgrade');
    expect(upgrades.map((c) => c.args)).toEqual([['upgrade', 'yt-dlp']]);
    expect(report.entries?.find((e) => e.key === 'yt-dlp')?.value).toBe(
      'upgraded to 2.0',
    );
    expect(report.entries?.find((e) => e.key === 'browser-tool')?.status).toBe(
      'unchanged',
    );
  },
);

sandboxTest(
  'upgrade mode reports tools already at latest as unchanged',
  async (dir) => {
    await deployConfig(dir);
    const listed = listJson({
      'yt-dlp': {
        package: 'yt-dlp',
        package_version: '1.0',
      },
      'browser-tool': {
        package: 'browser-tool',
        package_version: '1.0.0',
        deps: ['browser-driver'],
      },
    });
    const { context, calls } = recordingContext({
      home: dir,
      respond: (cmd, args) => {
        if (cmd === 'pipx' && args[0] === 'upgrade') return ok();
        return baseResponder(listed)(cmd, args);
      },
    });

    const report = await runActivation(applyPipx(CONFIG_KEY), context, {
      upgrade: true,
    });

    expect(report.status).toBe('unchanged');
    expect(calls.some((c) => c.args[0] === 'upgrade')).toBe(true);
    expect(report.entries?.find((e) => e.key === 'yt-dlp')?.value).toBe(
      'up to date',
    );
  },
);

sandboxTest(
  'upgrade mode upgrades only the main package and re-runs post-install',
  async (dir) => {
    const roleDir = join(dir, '.mev', 'roles', 'pipx');
    await mkdir(roleDir, { recursive: true });
    await writeFile(
      join(roleDir, 'tools.yml'),
      [
        'tools:',
        '  media-tool:',
        '    version: latest',
        '    inject:',
        '      - media-driver',
        '    post_install:',
        '      bin: media-tool',
        '      args: [refresh]',
        '',
      ].join('\n'),
    );
    let mediaToolVersion = '1.0';
    const currentList = () =>
      listJson({
        'media-tool': {
          package: 'media-tool',
          package_version: mediaToolVersion,
          deps: ['media-driver'],
        },
      });
    const { context, calls } = recordingContext({
      home: dir,
      respond: (cmd, args) => {
        if (cmd === 'pipx' && args[0] === 'upgrade') {
          mediaToolVersion = '1.1';
          return ok();
        }
        return baseResponder(currentList())(cmd, args);
      },
    });

    const report = await runActivation(applyPipx(CONFIG_KEY), context, {
      upgrade: true,
    });

    expect(report.status).toBe('changed');
    const upgrade = calls.find((c) => c.args[0] === 'upgrade');
    // No --include-injected: only the declared main package is upgraded, so an
    // injection mev does not own is never touched.
    expect(upgrade?.args).toEqual(['upgrade', 'media-tool']);
    expect(report.entries?.find((e) => e.key === 'media-tool')?.value).toBe(
      'upgraded to 1.1, post-installed',
    );
    const post = calls.find((c) => c.command.endsWith('media-tool'));
    expect(post?.command).toBe(join(VENVS, 'media-tool', 'bin', 'media-tool'));
    expect(post?.args).toEqual(['refresh']);
  },
);

sandboxTest(
  'a failed install marks the tool failed but continues others',
  async (dir) => {
    await deployConfig(dir);
    const { context } = recordingContext({
      home: dir,
      respond: (cmd, args) => {
        if (cmd === 'brew') return ok(PREFIX);
        if (cmd === 'pipx' && args[0] === 'list') return ok(listJson({}));
        if (cmd === 'pipx' && args[0] === 'install' && args[1] === 'yt-dlp')
          return fail('network error');
        return ok('installed package');
      },
    });

    const report = await runActivation(applyPipx(CONFIG_KEY), context);

    expect(report.status).toBe('failed');
    const ytdlp = report.entries?.find((e) => e.key === 'yt-dlp');
    expect(ytdlp?.status).toBe('failed');
    expect(ytdlp?.error).toContain('network error');
    expect(report.entries?.find((e) => e.key === 'browser-tool')?.status).toBe(
      'changed',
    );
  },
);

sandboxTest(
  'failed when the pipx manifest tools value is not a mapping',
  async (dir) => {
    const roleDir = join(dir, '.mev', 'roles', 'pipx');
    await mkdir(roleDir, { recursive: true });
    await writeFile(
      join(roleDir, 'tools.yml'),
      'tools:\n  - package: yt-dlp\n    version: latest\n',
    );
    const { context, calls } = recordingContext({
      home: dir,
      respond: () => ok(),
    });

    const report = await runActivation(applyPipx(CONFIG_KEY), context);

    expect(report.status).toBe('failed');
    expect(report.error).toContain(
      'tools must be a mapping of package names to versions',
    );
    expect(calls).toHaveLength(0);
  },
);

sandboxTest(
  'failed when the pipx manifest contains unknown fields',
  async (dir) => {
    const roleDir = join(dir, '.mev', 'roles', 'pipx');
    await mkdir(roleDir, { recursive: true });
    await writeFile(
      join(roleDir, 'tools.yml'),
      'tools:\n  yt-dlp:\n    version: latest\n    comment: old schema\n',
    );
    const { context, calls } = recordingContext({
      home: dir,
      respond: () => ok(),
    });

    const report = await runActivation(applyPipx(CONFIG_KEY), context);

    expect(report.status).toBe('failed');
    expect(report.error).toContain('unknown field');
    expect(calls).toHaveLength(0);
  },
);

sandboxTest(
  'failed when package identities normalize to the same name',
  async (dir) => {
    const roleDir = join(dir, '.mev', 'roles', 'pipx');
    await mkdir(roleDir, { recursive: true });
    await writeFile(
      join(roleDir, 'tools.yml'),
      'tools:\n  demo.tool: latest\n  demo-tool: latest\n',
    );
    const { context, calls } = recordingContext({
      home: dir,
      respond: () => ok(),
    });

    const report = await runActivation(applyPipx(CONFIG_KEY), context);

    expect(report.status).toBe('failed');
    expect(report.error).toContain('duplicate');
    expect(calls).toHaveLength(0);
  },
);

sandboxTest(
  'failed when pipx list JSON omits required package fields',
  async (dir) => {
    await deployConfig(dir);
    const malformed = JSON.stringify({
      venvs: {
        'broken-tool': {
          metadata: {
            main_package: {
              package: 'broken-tool',
            },
          },
        },
      },
    });
    const { context } = recordingContext({
      home: dir,
      respond: baseResponder(malformed),
    });

    const report = await runActivation(applyPipx(CONFIG_KEY), context);

    expect(report.status).toBe('failed');
    expect(report.error).toContain('pipx list --json');
  },
);

sandboxTest(
  'failed when pipx list JSON contains malformed venv entries',
  async (dir) => {
    await deployConfig(dir);
    const malformed = JSON.stringify({
      venvs: { 'broken-tool': 'not an object' },
    });
    const { context } = recordingContext({
      home: dir,
      respond: baseResponder(malformed),
    });

    const report = await runActivation(applyPipx(CONFIG_KEY), context);

    expect(report.status).toBe('failed');
    expect(report.error).toContain("venv 'broken-tool' must be an object");
  },
);

const UNINSTALL_YAML = `
tools:
  yt-dlp: latest
uninstall:
  - old-tool
`.trimStart();

sandboxTest(
  'uninstall removes a listed installed tool before installs run',
  async (dir) => {
    await deployConfig(dir, UNINSTALL_YAML);
    const listed = listJson({
      'old-tool': {
        package: 'old-tool',
        package_version: '1.0',
      },
    });
    const { context, calls } = recordingContext({
      home: dir,
      respond: baseResponder(listed),
    });

    const report = await runActivation(applyPipx(CONFIG_KEY), context);

    expect(report.status).toBe('changed');
    expect(report.entries?.find((e) => e.key === 'old-tool')?.value).toBe(
      'uninstalled',
    );
    const verbs = calls
      .filter(
        (c) =>
          c.command === 'pipx' &&
          (c.args[0] === 'uninstall' || c.args[0] === 'install'),
      )
      .map((c) => c.args);
    expect(verbs).toEqual([
      ['uninstall', 'old-tool'],
      ['install', 'yt-dlp'],
    ]);
  },
);

sandboxTest(
  'uninstall of an already absent tool runs nothing and reports unchanged',
  async (dir) => {
    await deployConfig(dir, UNINSTALL_YAML);
    const listed = listJson({
      'yt-dlp': {
        package: 'yt-dlp',
        package_version: '1.0',
      },
    });
    const { context, calls } = recordingContext({
      home: dir,
      respond: baseResponder(listed),
    });

    const report = await runActivation(applyPipx(CONFIG_KEY), context);

    expect(report.status).toBe('unchanged');
    expect(report.entries?.find((e) => e.key === 'old-tool')?.value).toBe(
      'already absent',
    );
    expect(calls.some((c) => c.args[0] === 'uninstall')).toBe(false);
  },
);

sandboxTest(
  'failed when a name is declared in both tools and uninstall',
  async (dir) => {
    await deployConfig(
      dir,
      'tools:\n  yt-dlp: latest\nuninstall:\n  - yt_dlp\n',
    );
    const { context, calls } = recordingContext({
      home: dir,
      respond: () => ok(),
    });

    const report = await runActivation(applyPipx(CONFIG_KEY), context);

    expect(report.status).toBe('failed');
    expect(report.error).toContain('duplicate');
    expect(calls).toHaveLength(0);
  },
);

sandboxTest(
  'manifest spellings resolve to installed tools across hyphen/underscore variants',
  async (dir) => {
    await deployConfig(
      dir,
      'tools:\n  yt_dlp: latest\nuninstall:\n  - old_tool\n',
    );
    const listed = listJson({
      'yt-dlp': {
        package: 'yt-dlp',
        package_version: '1.0',
      },
      'old-tool': {
        package: 'old-tool',
        package_version: '1.0',
      },
    });
    const { context, calls } = recordingContext({
      home: dir,
      respond: baseResponder(listed),
    });

    const report = await runActivation(applyPipx(CONFIG_KEY), context);

    expect(report.status).toBe('changed');
    // The already-installed variant spelling is recognized, not reinstalled.
    expect(report.entries?.find((e) => e.key === 'yt_dlp')?.value).toBe(
      'up to date',
    );
    expect(calls.some((c) => c.args[0] === 'install')).toBe(false);
    // The removal command receives pipx's reported spelling, not the manifest's.
    const uninstalls = calls.filter((c) => c.args[0] === 'uninstall');
    expect(uninstalls.map((c) => c.args)).toEqual([['uninstall', 'old-tool']]);
  },
);
