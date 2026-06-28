import { expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CommandResult } from '../../src/host/command';
import type { Context } from '../../src/host/context';
import { applyPipx, runActivation } from '../../src/provisioning/activation';

const CONFIG_KEY = 'pipx/global/tools.yml';

const YAML = `
tools:
  - package: yt-dlp
  - package: dcv
    version: 0.5.0
    install_spec: git+https://github.com/akitorahayashi/dcv.git@v0.5.0
    inject:
      - playwright
    post_install:
      bin: playwright
      args: [install, chromium]
`.trimStart();

async function withSandbox(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = join(
    process.cwd(),
    '.tmp',
    `pipx-${process.pid}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  try {
    await fn(dir);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}

async function deployConfig(dir: string): Promise<void> {
  const roleDir = join(dir, '.config', 'mev', 'roles', 'pipx', 'global');
  await mkdir(roleDir, { recursive: true });
  await writeFile(join(roleDir, 'tools.yml'), YAML);
}

interface Call {
  readonly command: string;
  readonly args: readonly string[];
}

function contextWith(
  home: string,
  responder: (command: string, args: readonly string[]) => CommandResult,
): { context: Context; calls: Call[] } {
  const calls: Call[] = [];
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

const ok = (stdout = ''): CommandResult => ({ code: 0, stdout, stderr: '' });
const fail = (stderr = ''): CommandResult => ({ code: 1, stdout: '', stderr });

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

test('all tools current: no install/inject/post-install runs', async () => {
  await withSandbox(async (dir) => {
    await deployConfig(dir);
    const listed = listJson({
      'yt-dlp': {
        package: 'yt-dlp',
        package_or_url: 'yt-dlp',
        package_version: '1.0',
      },
      dcv: {
        package: 'dcv',
        package_or_url: 'git+https://github.com/akitorahayashi/dcv.git@v0.5.0',
        package_version: '0.5.0',
        deps: ['playwright'],
      },
    });
    const { context, calls } = contextWith(dir, baseResponder(listed));

    const report = await runActivation(applyPipx(CONFIG_KEY), context, false);

    expect(report.status).toBe('unchanged');
    expect(calls.some((c) => c.args[0] === 'install')).toBe(false);
    expect(calls.some((c) => c.args[0] === 'inject')).toBe(false);
  });
});

test('fresh install runs install, inject, then post-install in order', async () => {
  await withSandbox(async (dir) => {
    await deployConfig(dir);
    const { context, calls } = contextWith(dir, baseResponder(listJson({})));

    const report = await runActivation(applyPipx(CONFIG_KEY), context, false);

    expect(report.status).toBe('changed');
    const dcvCalls = calls.filter(
      (c) =>
        c.args.some((a) => a.includes('dcv')) || c.command.includes('/dcv/'),
    );
    const verbs = dcvCalls.map((c) =>
      c.command.endsWith('playwright') ? 'post' : c.args[0],
    );
    expect(verbs).toEqual(['install', 'inject', 'post']);
    const post = calls.find((c) => c.command.endsWith('playwright'));
    expect(post?.command).toBe(join(VENVS, 'dcv', 'bin', 'playwright'));
    expect(post?.args).toEqual(['install', 'chromium']);
  });
});

test('version mismatch triggers uninstall before install', async () => {
  await withSandbox(async (dir) => {
    await deployConfig(dir);
    const listed = listJson({
      dcv: {
        package: 'dcv',
        package_or_url: 'git+https://github.com/akitorahayashi/dcv.git@v0.5.0',
        package_version: '0.4.0',
        deps: ['playwright'],
      },
      'yt-dlp': {
        package: 'yt-dlp',
        package_or_url: 'yt-dlp',
        package_version: '1.0',
      },
    });
    const { context, calls } = contextWith(dir, baseResponder(listed));

    await runActivation(applyPipx(CONFIG_KEY), context, false);

    const dcv = calls.filter((c) => c.args.some((a) => a.includes('dcv')));
    expect(dcv.map((c) => c.args[0])).toEqual([
      'uninstall',
      'install',
      'inject',
    ]);
  });
});

test('a failed install marks the tool failed but continues others', async () => {
  await withSandbox(async (dir) => {
    await deployConfig(dir);
    const { context } = contextWith(dir, (cmd, args) => {
      if (cmd === 'brew') return ok(PREFIX);
      if (cmd === 'pipx' && args[0] === 'list') return ok(listJson({}));
      if (cmd === 'pipx' && args[0] === 'install' && args[1] === 'yt-dlp')
        return fail('network error');
      return ok('installed package');
    });

    const report = await runActivation(applyPipx(CONFIG_KEY), context, false);

    expect(report.status).toBe('failed');
    const ytdlp = report.entries?.find((e) => e.key === 'yt-dlp');
    expect(ytdlp?.status).toBe('failed');
    expect(ytdlp?.error).toBe('network error');
    expect(report.entries?.find((e) => e.key === 'dcv')?.status).toBe(
      'changed',
    );
  });
});

test('plan mode reports changed without running any command', async () => {
  await withSandbox(async (dir) => {
    await deployConfig(dir);
    const { context, calls } = contextWith(dir, () => ok());

    const report = await runActivation(applyPipx(CONFIG_KEY), context, true);

    expect(report.status).toBe('changed');
    expect(calls).toHaveLength(0);
  });
});

test('failed when the pipx manifest contains non-string package names', async () => {
  await withSandbox(async (dir) => {
    const roleDir = join(dir, '.config', 'mev', 'roles', 'pipx', 'global');
    await mkdir(roleDir, { recursive: true });
    await writeFile(join(roleDir, 'tools.yml'), 'tools:\n  - package: 42\n');
    const { context, calls } = contextWith(dir, () => ok());

    const report = await runActivation(applyPipx(CONFIG_KEY), context, false);

    expect(report.status).toBe('failed');
    expect(report.error).toContain('package name');
    expect(calls).toHaveLength(0);
  });
});

test('failed when pipx list JSON omits required package fields', async () => {
  await withSandbox(async (dir) => {
    await deployConfig(dir);
    const malformed = JSON.stringify({
      venvs: {
        dcv: {
          metadata: {
            main_package: {
              package: 'dcv',
              package_or_url: 'dcv',
            },
          },
        },
      },
    });
    const { context } = contextWith(dir, baseResponder(malformed));

    const report = await runActivation(applyPipx(CONFIG_KEY), context, false);

    expect(report.status).toBe('failed');
    expect(report.error).toContain('pipx list --json');
  });
});

test('failed when pipx list JSON contains malformed venv entries', async () => {
  await withSandbox(async (dir) => {
    await deployConfig(dir);
    const malformed = JSON.stringify({ venvs: { dcv: 'not an object' } });
    const { context } = contextWith(dir, baseResponder(malformed));

    const report = await runActivation(applyPipx(CONFIG_KEY), context, false);

    expect(report.status).toBe('failed');
    expect(report.error).toContain("venv 'dcv' must be an object");
  });
});
