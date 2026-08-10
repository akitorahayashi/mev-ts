import { expect } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CommandResult } from '../../src/host/command';
import { applyPnpm, runActivation } from '../../src/provisioning/activation';
import { fail, ok } from '../fixtures/fake-command-runner';
import type { Invocation } from '../fixtures/fake-context';
import { recordingContext } from '../fixtures/fake-context';
import { sandboxedTest } from '../fixtures/temporary-directory';

const CONFIG_KEY = 'pnpm/global-packages.yml';
const PREFIX = '/opt/homebrew';
const PNPM_BIN = `${PREFIX}/bin/pnpm`;

const sandboxTest = sandboxedTest('pnpm-');

async function deployConfig(dir: string, yaml: string): Promise<void> {
  const roleDir = join(dir, '.mev', 'roles', 'pnpm');
  await mkdir(roleDir, { recursive: true });
  await writeFile(join(roleDir, 'global-packages.yml'), yaml);
}

function lsJson(deps: Record<string, string>): string {
  const project: Record<string, unknown> = {
    path: '/g/global/v11',
    private: true,
  };
  if (Object.keys(deps).length > 0) {
    project['dependencies'] = Object.fromEntries(
      Object.entries(deps).map(([name, version]) => [
        name,
        { from: name, version, path: `/g/${name}` },
      ]),
    );
  }
  return JSON.stringify([project]);
}

/** The pnpm argv after the `fnm exec --using=default -- <pnpm>` prefix. */
function pnpmArgs(call: Invocation): readonly string[] | null {
  if (call.command !== 'fnm') return null;
  const index = call.args.indexOf(PNPM_BIN);
  return index === -1 ? null : call.args.slice(index + 1);
}

function packageOps(calls: readonly Invocation[]): readonly string[][] {
  return calls
    .map(pnpmArgs)
    .filter((args): args is string[] => args !== null && args[0] !== 'ls');
}

function baseResponder(listOutputs: readonly string[]) {
  let lists = 0;
  return (cmd: string, args: readonly string[]): CommandResult => {
    if (cmd === 'brew' && args[0] === '--prefix') return ok(PREFIX);
    if (cmd === 'fnm' && args.includes('node')) return ok('v22.0.0');
    if (cmd === 'fnm' && args.includes(PNPM_BIN)) {
      const sub = args[args.indexOf(PNPM_BIN) + 1];
      if (sub === 'ls') {
        const output = listOutputs[Math.min(lists, listOutputs.length - 1)];
        lists += 1;
        return ok(output ?? lsJson({}));
      }
      return ok();
    }
    return ok();
  };
}

sandboxTest('fresh install adds every declared package', async (dir) => {
  await deployConfig(
    dir,
    'packages:\n  "@toon-format/cli": latest\n  typescript: 5.6.2\n',
  );
  const { context, calls } = recordingContext({
    home: dir,
    respond: baseResponder([lsJson({})]),
  });

  const report = await runActivation(applyPnpm(CONFIG_KEY), context);

  expect(report.status).toBe('changed');
  expect(packageOps(calls)).toEqual([
    ['add', '-g', '@toon-format/cli@latest'],
    ['add', '-g', 'typescript@5.6.2'],
  ]);
});

sandboxTest('all packages current: no add or remove runs', async (dir) => {
  await deployConfig(
    dir,
    'packages:\n  "@toon-format/cli": latest\n  typescript: 5.6.2\n',
  );
  const { context, calls } = recordingContext({
    home: dir,
    respond: baseResponder([
      lsJson({ '@toon-format/cli': '4.1.1', typescript: '5.6.2' }),
    ]),
  });

  const report = await runActivation(applyPnpm(CONFIG_KEY), context);

  expect(report.status).toBe('unchanged');
  expect(packageOps(calls)).toEqual([]);
});

sandboxTest(
  'an installed package matches its declaration regardless of case',
  async (dir) => {
    // npm registry names are case-insensitively unique, so a manifest that
    // differs only in case from what pnpm reports is the same package: a
    // case-sensitive lookup would re-add it on every run.
    await deployConfig(dir, 'packages:\n  TypeScript: 5.6.2\n');
    const { context, calls } = recordingContext({
      home: dir,
      respond: baseResponder([lsJson({ typescript: '5.6.2' })]),
    });

    const report = await runActivation(applyPnpm(CONFIG_KEY), context);

    expect(report.status).toBe('unchanged');
    expect(packageOps(calls)).toEqual([]);
  },
);

sandboxTest('a pin mismatch re-adds the pinned version', async (dir) => {
  await deployConfig(dir, 'packages:\n  typescript: 5.6.2\n');
  const { context, calls } = recordingContext({
    home: dir,
    respond: baseResponder([lsJson({ typescript: '5.5.0' })]),
  });

  const report = await runActivation(applyPnpm(CONFIG_KEY), context);

  expect(report.status).toBe('changed');
  expect(packageOps(calls)).toEqual([['add', '-g', 'typescript@5.6.2']]);
});

sandboxTest(
  'upgrade mode re-resolves latest-assumed packages and skips pinned ones',
  async (dir) => {
    await deployConfig(
      dir,
      'packages:\n  "@marp-team/marp-cli": latest\n  typescript: 5.6.2\n',
    );
    const before = lsJson({
      '@marp-team/marp-cli': '4.5.0',
      typescript: '5.6.2',
    });
    const after = lsJson({
      '@marp-team/marp-cli': '4.6.0',
      typescript: '5.6.2',
    });
    const { context, calls } = recordingContext({
      home: dir,
      respond: baseResponder([before, after]),
    });

    const report = await runActivation(applyPnpm(CONFIG_KEY), context, {
      upgrade: true,
    });

    expect(report.status).toBe('changed');
    expect(packageOps(calls)).toEqual([
      ['add', '-g', '@marp-team/marp-cli@latest'],
    ]);
    expect(
      report.entries?.find((e) => e.key === '@marp-team/marp-cli')?.value,
    ).toBe('upgraded to 4.6.0');
    expect(report.entries?.find((e) => e.key === 'typescript')?.status).toBe(
      'unchanged',
    );
  },
);

sandboxTest(
  'upgrade mode reports packages already at latest as unchanged',
  async (dir) => {
    await deployConfig(dir, 'packages:\n  "@marp-team/marp-cli": latest\n');
    const listed = lsJson({ '@marp-team/marp-cli': '4.5.0' });
    const { context, calls } = recordingContext({
      home: dir,
      respond: baseResponder([listed, listed]),
    });

    const report = await runActivation(applyPnpm(CONFIG_KEY), context, {
      upgrade: true,
    });

    expect(report.status).toBe('unchanged');
    expect(packageOps(calls)).toEqual([
      ['add', '-g', '@marp-team/marp-cli@latest'],
    ]);
    expect(
      report.entries?.find((e) => e.key === '@marp-team/marp-cli')?.value,
    ).toBe('up to date');
  },
);

sandboxTest(
  'uninstall removes a listed installed package before installs run',
  async (dir) => {
    await deployConfig(
      dir,
      'packages:\n  typescript: latest\nuninstall:\n  - old-cli\n',
    );
    const { context, calls } = recordingContext({
      home: dir,
      respond: baseResponder([lsJson({ 'old-cli': '1.0.0' })]),
    });

    const report = await runActivation(applyPnpm(CONFIG_KEY), context);

    expect(report.status).toBe('changed');
    expect(report.entries?.find((e) => e.key === 'old-cli')?.value).toBe(
      'uninstalled',
    );
    expect(packageOps(calls)).toEqual([
      ['remove', '-g', 'old-cli'],
      ['add', '-g', 'typescript@latest'],
    ]);
  },
);

sandboxTest(
  'uninstall of an already absent package runs nothing and reports unchanged',
  async (dir) => {
    await deployConfig(
      dir,
      'packages:\n  typescript: latest\nuninstall:\n  - old-cli\n',
    );
    const { context, calls } = recordingContext({
      home: dir,
      respond: baseResponder([lsJson({ typescript: '5.6.2' })]),
    });

    const report = await runActivation(applyPnpm(CONFIG_KEY), context);

    expect(report.status).toBe('unchanged');
    expect(report.entries?.find((e) => e.key === 'old-cli')?.value).toBe(
      'already absent',
    );
    expect(packageOps(calls)).toEqual([]);
  },
);

sandboxTest(
  'a failed add marks the package failed but continues others',
  async (dir) => {
    await deployConfig(
      dir,
      'packages:\n  "@toon-format/cli": latest\n  typescript: latest\n',
    );
    const base = baseResponder([lsJson({})]);
    const { context } = recordingContext({
      home: dir,
      respond: (cmd, args) => {
        if (
          cmd === 'fnm' &&
          args.includes('add') &&
          args.some((a) => a.startsWith('@toon-format/cli'))
        ) {
          return fail('network error');
        }
        return base(cmd, args);
      },
    });

    const report = await runActivation(applyPnpm(CONFIG_KEY), context);

    expect(report.status).toBe('failed');
    const failed = report.entries?.find((e) => e.key === '@toon-format/cli');
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toContain('network error');
    expect(report.entries?.find((e) => e.key === 'typescript')?.status).toBe(
      'changed',
    );
  },
);

sandboxTest(
  'failed when the manifest declares a range version',
  async (dir) => {
    await deployConfig(dir, 'packages:\n  typescript: "^5.0.0"\n');
    const { context, calls } = recordingContext({
      home: dir,
      respond: () => ok(),
    });

    const report = await runActivation(applyPnpm(CONFIG_KEY), context);

    expect(report.status).toBe('failed');
    expect(report.error).toContain('exact version pin');
    expect(calls).toHaveLength(0);
  },
);

sandboxTest('failed when pnpm ls output is not JSON', async (dir) => {
  await deployConfig(dir, 'packages:\n  typescript: latest\n');
  const { context } = recordingContext({
    home: dir,
    respond: baseResponder(['not json']),
  });

  const report = await runActivation(applyPnpm(CONFIG_KEY), context);

  expect(report.status).toBe('failed');
  expect(report.error).toContain('pnpm ls -g --json');
});

sandboxTest(
  'pnpm runs under PNPM_HOME with its global bin directory on PATH',
  async (dir) => {
    await deployConfig(dir, 'packages:\n  typescript: latest\n');
    const { context, calls } = recordingContext({
      home: dir,
      basePath: '/usr/bin',
      respond: baseResponder([lsJson({})]),
    });

    await runActivation(applyPnpm(CONFIG_KEY), context);

    const add = calls.find((c) => pnpmArgs(c)?.[0] === 'add');
    expect(add?.args.slice(0, 4)).toEqual([
      'exec',
      '--using=default',
      '--',
      PNPM_BIN,
    ]);
    const pnpmHome = join(dir, 'Library/pnpm');
    expect(add?.options?.env).toEqual({
      PNPM_HOME: pnpmHome,
      // pnpm 11 rejects every global command when $PNPM_HOME/bin is off PATH.
      PATH: `${PREFIX}/bin:${pnpmHome}/bin:${pnpmHome}:/usr/bin`,
    });
  },
);

sandboxTest(
  'a removal that sweeps a declared package reinstalls it from the refreshed inventory',
  async (dir) => {
    await deployConfig(
      dir,
      'packages:\n  typescript: latest\nuninstall:\n  - old-cli\n',
    );
    // pnpm removes whole installation groups: removing old-cli also sweeps
    // typescript here, which only the post-removal inventory can reveal.
    const before = lsJson({ 'old-cli': '1.0.0', typescript: '5.6.2' });
    const after = lsJson({});
    const { context, calls } = recordingContext({
      home: dir,
      respond: baseResponder([before, after]),
    });

    const report = await runActivation(applyPnpm(CONFIG_KEY), context);

    expect(report.status).toBe('changed');
    expect(packageOps(calls)).toEqual([
      ['remove', '-g', 'old-cli'],
      ['add', '-g', 'typescript@latest'],
    ]);
    expect(report.entries?.find((e) => e.key === 'typescript')?.value).toBe(
      'installed',
    );
  },
);

sandboxTest(
  'no removals: installs reconcile against the initial inventory without a re-read',
  async (dir) => {
    await deployConfig(dir, 'packages:\n  typescript: latest\n');
    const { context, calls } = recordingContext({
      home: dir,
      respond: baseResponder([lsJson({ typescript: '5.6.2' })]),
    });

    const report = await runActivation(applyPnpm(CONFIG_KEY), context);

    expect(report.status).toBe('unchanged');
    const lists = calls.filter((c) => pnpmArgs(c)?.[0] === 'ls');
    expect(lists).toHaveLength(1);
  },
);

sandboxTest(
  'a failed removal marks the entry failed but installs still run',
  async (dir) => {
    await deployConfig(
      dir,
      'packages:\n  typescript: latest\nuninstall:\n  - old-cli\n',
    );
    const base = baseResponder([lsJson({ 'old-cli': '1.0.0' })]);
    const { context, calls } = recordingContext({
      home: dir,
      respond: (cmd, args) => {
        if (cmd === 'fnm' && args.includes('remove')) {
          return fail('store is locked');
        }
        return base(cmd, args);
      },
    });

    const report = await runActivation(applyPnpm(CONFIG_KEY), context);

    expect(report.status).toBe('failed');
    const removal = report.entries?.find((e) => e.key === 'old-cli');
    expect(removal?.status).toBe('failed');
    expect(removal?.error).toContain('store is locked');
    expect(report.entries?.find((e) => e.key === 'typescript')?.status).toBe(
      'changed',
    );
    expect(packageOps(calls).some((args) => args[0] === 'add')).toBe(true);
  },
);
