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
  - package: yt-dlp
  - package: browser-tool
    version: 1.0.0
    install_spec: git+https://example.com/browser-tool.git@v1.0.0
    inject:
      - browser-driver
    post_install:
      bin: browser-tool
      args: [setup]
`.trimStart();

const sandboxTest = sandboxedTest('pipx-');

async function deployConfig(dir: string): Promise<void> {
  const roleDir = join(dir, '.mev', 'roles', 'pipx');
  await mkdir(roleDir, { recursive: true });
  await writeFile(join(roleDir, 'tools.yml'), YAML);
}

const PREFIX = '/opt/homebrew';

function listJson(
  venvs: Record<
    string,
    {
      package: string;
      package_or_url: string;
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
          package_or_url: v.package_or_url,
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
        package_or_url: 'yt-dlp',
        package_version: '1.0',
      },
      'browser-tool': {
        package: 'browser-tool',
        package_or_url: 'git+https://example.com/browser-tool.git@v1.0.0',
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
        package_or_url: 'git+https://example.com/browser-tool.git@v1.0.0',
        package_version: '0.9.0',
        deps: ['browser-driver'],
      },
      'yt-dlp': {
        package: 'yt-dlp',
        package_or_url: 'yt-dlp',
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
  'failed when the pipx manifest contains non-string package names',
  async (dir) => {
    const roleDir = join(dir, '.mev', 'roles', 'pipx');
    await mkdir(roleDir, { recursive: true });
    await writeFile(join(roleDir, 'tools.yml'), 'tools:\n  - package: 42\n');
    const { context, calls } = recordingContext({
      home: dir,
      respond: () => ok(),
    });

    const report = await runActivation(applyPipx(CONFIG_KEY), context);

    expect(report.status).toBe('failed');
    expect(report.error).toContain('package name');
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
      'tools:\n  - package: yt-dlp\n    comment: old schema\n',
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
      'tools:\n  - package: demo.tool\n  - package: demo-tool\n',
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
              package_or_url: 'broken-tool',
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
