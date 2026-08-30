import { expect } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Context } from '../../src/host/context';
import { home as hostHome } from '../../src/host/path';
import {
  type ActivationRunOptions,
  installAgentPlugins,
  runActivation,
} from '../../src/provisioning/activation';
import { fail, ok } from '../fixtures/fake-command-runner';
import { recordingContext } from '../fixtures/fake-context';
import { sandboxedTest } from '../fixtures/temporary-directory';

const CONFIG_KEY = 'coder/plugins.yml';
const FULL_CATALOG = `
marketplaces:
  - clients: [claude]
    repo: akitorahayashi/agent-device-plugin
    plugins: [agent-device, device-verification]
  - clients: [claude]
    repo: akitorahayashi/comment-review
    plugins: [comment-review]
  - clients: [claude, codex]
    repo: akitorahayashi/xlsx
    plugins: [xlsx]
`;

const sandboxTest = sandboxedTest('agent-plugins-');

const run = (context: Context, options?: ActivationRunOptions) =>
  runActivation(
    installAgentPlugins(CONFIG_KEY, [hostHome('.local/bin')]),
    context,
    options,
  );

async function deployCatalog(
  home: string,
  catalog = FULL_CATALOG,
): Promise<void> {
  const directory = join(home, '.mev/roles/coder');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'plugins.yml'), catalog);
}

// One builder per client over entries. A bare string is an enabled, unversioned
// plugin — what a normally-installed one looks like, and the state a
// declaration converges on; version and enabled are opted into per entry.
type InventoryEntry =
  | string
  | {
      readonly id: string;
      readonly version?: string;
      readonly enabled?: boolean;
    };

function inventoryEntry(spec: InventoryEntry) {
  return typeof spec === 'string' ? { id: spec } : spec;
}

function claudeInventory(specs: readonly InventoryEntry[]): string {
  return JSON.stringify(
    specs.map(inventoryEntry).map(({ id, version, enabled }) => ({
      id,
      version,
      scope: 'user',
      enabled: enabled ?? true,
    })),
  );
}

function codexInventory(specs: readonly InventoryEntry[]): string {
  return JSON.stringify({
    installed: specs.map(inventoryEntry).map(({ id, version, enabled }) => ({
      pluginId: id,
      version,
      enabled: enabled ?? true,
    })),
    available: [],
  });
}

const UPGRADE_CATALOG = `
marketplaces:
  - clients: [claude, codex]
    repo: akitorahayashi/xlsx
    plugins: [xlsx]
`;

const CLAUDE_XLSX_MARKETPLACES = JSON.stringify([
  {
    name: 'xlsx',
    source: 'git',
    url: 'git@github.com:akitorahayashi/xlsx.git',
    ref: 'main',
  },
]);

const CODEX_XLSX_MARKETPLACES = JSON.stringify({
  marketplaces: [
    {
      name: 'xlsx',
      marketplaceSource: {
        sourceType: 'git',
        source: 'git@github.com:akitorahayashi/xlsx.git',
      },
    },
  ],
});

sandboxTest(
  'holds marketplaces still when plugins are installed and registrations match',
  async (home) => {
    await deployCatalog(home);
    const { context, calls } = recordingContext({
      home,
      basePath: '/opt/homebrew/bin:/usr/bin',
      respond: (command, args) => {
        if (command === 'claude' && args.join(' ') === 'plugin list --json') {
          return ok(
            claudeInventory([
              'agent-device@agent-device-plugin',
              'device-verification@agent-device-plugin',
              'comment-review@comment-review',
              'xlsx@xlsx',
            ]),
          );
        }
        if (
          command === 'claude' &&
          args.join(' ') === 'plugin marketplace list --json'
        ) {
          return ok(
            JSON.stringify(
              ['agent-device-plugin', 'comment-review', 'xlsx'].map((name) => ({
                name,
                source: 'git',
                url: `git@github.com:akitorahayashi/${name}.git`,
                ref: 'main',
              })),
            ),
          );
        }
        if (command === 'codex' && args.join(' ') === 'plugin list --json') {
          return ok(codexInventory(['xlsx@xlsx']));
        }
        if (
          command === 'codex' &&
          args.join(' ') === 'plugin marketplace list --json'
        ) {
          return ok(
            JSON.stringify({
              marketplaces: [
                {
                  name: 'xlsx',
                  marketplaceSource: {
                    sourceType: 'git',
                    source: 'git@github.com:akitorahayashi/xlsx.git',
                  },
                },
              ],
            }),
          );
        }
        return fail(`unexpected ${command} ${args.join(' ')}`);
      },
    });

    const report = await run(context);

    // Local reads only — the inventory and one registration listing per
    // client — and no mutation or network fetch of any kind.
    expect(report.status).toBe('unchanged');
    expect(
      calls.map(({ command, args }) => `${command} ${args.join(' ')}`),
    ).toEqual([
      'claude plugin list --json',
      'codex plugin list --json',
      'claude plugin marketplace list --json',
      'codex plugin marketplace list --json',
    ]);
    expect(
      calls.every(
        ({ options }) =>
          options?.env?.['PATH'] ===
          `${home}/.local/bin:/opt/homebrew/bin:/usr/bin`,
      ),
    ).toBe(true);
    expect(
      report.entries?.every(({ value }) => value === 'already installed'),
    ).toBe(true);
  },
);

const DISABLED_CATALOG = `
marketplaces:
  - clients: [claude]
    repo: akitorahayashi/xlsx
    plugins: [xlsx]
`;

/**
 * A claude whose declared plugin is installed but disabled, with the marketplace
 * registered at the declared source and DISABLED_CATALOG already deployed.
 * `enabled` flips once the enable verb takes effect, so the post-run inventory
 * reflects it — the CLI's own behavior, and what the activation's verification
 * reads. The one discriminant names how the enable verb behaves.
 */
async function disabledClaude(
  home: string,
  enable: 'enables' | 'fails' | 'reports-success-only',
) {
  await deployCatalog(home, DISABLED_CATALOG);
  let enabled = false;
  return recordingContext({
    home,
    respond: (command, args) => {
      if (command !== 'claude') return fail(`unexpected ${command}`);
      const line = args.join(' ');
      if (line === 'plugin list --json') {
        return ok(claudeInventory([{ id: 'xlsx@xlsx', enabled }]));
      }
      if (line === 'plugin marketplace list --json') {
        return ok(CLAUDE_XLSX_MARKETPLACES);
      }
      if (line === 'plugin enable xlsx@xlsx --scope user') {
        if (enable === 'fails') return fail('enable refused');
        enabled = enable === 'enables';
        return ok();
      }
      if (args[1] === 'marketplace') return ok();
      return fail(`unexpected ${command} ${line}`);
    },
  });
}

sandboxTest(
  'enables a declared plugin that is installed but disabled',
  async (home) => {
    const { context, calls } = await disabledClaude(home, 'enables');

    const first = await run(context);
    const second = await run(context);

    expect(first.status).toBe('changed');
    expect(first.entries).toEqual([
      { key: 'claude:xlsx@xlsx', value: 'enabled', status: 'changed' },
    ]);
    expect(
      calls.some(
        ({ args }) => args.join(' ') === 'plugin enable xlsx@xlsx --scope user',
      ),
    ).toBe(true);
    // Presence alone never satisfied the declaration, and once enabled the run
    // holds still: no reinstall, no second enable.
    expect(second.status).toBe('unchanged');
    expect(second.entries).toEqual([
      {
        key: 'claude:xlsx@xlsx',
        value: 'already installed',
        status: 'unchanged',
      },
    ]);
  },
);

sandboxTest(
  'a failing marketplace listing fails only its own marketplaces',
  async (home) => {
    await deployCatalog(home);
    const { context } = recordingContext({
      home,
      respond: (command, args) => {
        const line = args.join(' ');
        if (command === 'claude' && line === 'plugin list --json') {
          return ok(
            claudeInventory([
              'agent-device@agent-device-plugin',
              'device-verification@agent-device-plugin',
              'comment-review@comment-review',
              'xlsx@xlsx',
            ]),
          );
        }
        // The registration probe's listing fails on a run whose plugins are
        // all installed — the probe must stay inside the per-marketplace
        // boundary rather than aborting the whole activation.
        if (command === 'claude' && line === 'plugin marketplace list --json') {
          return fail('claude marketplace listing unavailable');
        }
        if (command === 'codex' && line === 'plugin list --json') {
          return ok(codexInventory(['xlsx@xlsx']));
        }
        if (command === 'codex' && line === 'plugin marketplace list --json') {
          return ok(CODEX_XLSX_MARKETPLACES);
        }
        return fail(`unexpected ${command} ${line}`);
      },
    });

    const report = await run(context);

    // Each of the three claude marketplaces reports unavailable, while the
    // codex marketplace still converges and reports its plugin unchanged.
    expect(report.status).toBe('failed');
    expect(report.error).toBeUndefined();
    expect(
      report.entries?.filter(({ value }) => value === 'marketplace unavailable')
        .length,
    ).toBe(3);
    expect(report.entries).toContainEqual({
      key: 'codex:xlsx@xlsx',
      value: 'already installed',
      status: 'unchanged',
    });
  },
);

sandboxTest('enabling a plugin stays off the network', async (home) => {
  const { context, calls } = await disabledClaude(home, 'enables');

  await run(context);

  // Nothing is missing and the registration matches, so the marketplace is
  // neither refreshed nor re-registered: a local boolean does not earn a fetch.
  expect(calls.map(({ args }) => args.join(' '))).toEqual([
    'plugin list --json',
    'plugin marketplace list --json',
    'plugin enable xlsx@xlsx --scope user',
    'plugin list --json',
  ]);
});

sandboxTest('a failing enable is reported as failed', async (home) => {
  const { context } = await disabledClaude(home, 'fails');

  const report = await run(context);

  expect(report.status).toBe('failed');
  expect(report.entries?.[0]?.value).toBe('enable failed');
});

sandboxTest(
  'an enable that reports success but leaves the plugin disabled fails verification',
  async (home) => {
    const { context } = await disabledClaude(home, 'reports-success-only');

    const report = await run(context);

    expect(report.status).toBe('failed');
    expect(report.entries?.[0]?.value).toBe('verification failed');
    expect(report.entries?.[0]?.error).toContain('still disabled');
  },
);

sandboxTest(
  'a disabled plugin outside the catalog is left alone',
  async (home) => {
    await deployCatalog(home, DISABLED_CATALOG);
    const { context, calls } = recordingContext({
      home,
      respond: (command, args) => {
        const line = args.join(' ');
        if (command === 'claude' && line === 'plugin list --json') {
          return ok(
            JSON.stringify([
              { id: 'xlsx@xlsx', scope: 'user', enabled: true },
              { id: 'manual@elsewhere', scope: 'user', enabled: false },
            ]),
          );
        }
        if (command === 'claude' && line === 'plugin marketplace list --json') {
          return ok(CLAUDE_XLSX_MARKETPLACES);
        }
        return fail(`unexpected ${command} ${line}`);
      },
    });

    const report = await run(context);

    // Nothing is derived from inventory diffs: enablement is converged only for
    // the ids the catalog declares.
    expect(report.status).toBe('unchanged');
    expect(calls.some(({ args }) => args[1] === 'enable')).toBe(false);
  },
);

sandboxTest(
  'adds SSH marketplaces and installs only missing plugins',
  async (home) => {
    await deployCatalog(home);
    const claudeInstalled = new Set<string>();
    const codexInstalled = new Set<string>();
    const { context, calls } = recordingContext({
      home,
      respond: (command, args) => {
        if (command === 'claude' && args.join(' ') === 'plugin list --json') {
          return ok(claudeInventory([...claudeInstalled]));
        }
        if (
          command === 'claude' &&
          args.join(' ') === 'plugin marketplace list --json'
        ) {
          return ok('[]');
        }
        if (command === 'claude' && args[1] === 'install') {
          claudeInstalled.add(args[2] as string);
          return ok();
        }
        if (command === 'claude' && args[1] === 'marketplace') return ok();
        if (command === 'codex' && args.join(' ') === 'plugin list --json') {
          return ok(codexInventory([...codexInstalled]));
        }
        if (
          command === 'codex' &&
          args.join(' ') === 'plugin marketplace list --json'
        ) {
          return ok(JSON.stringify({ marketplaces: [] }));
        }
        if (
          command === 'codex' &&
          args[1] === 'marketplace' &&
          args[2] === 'add'
        ) {
          return ok(JSON.stringify({ alreadyAdded: false }));
        }
        if (command === 'codex' && args[1] === 'add') {
          codexInstalled.add(args[2] as string);
          return ok('{}');
        }
        return fail(`unexpected ${command} ${args.join(' ')}`);
      },
    });

    const report = await run(context);

    expect(report.status).toBe('changed');
    expect(claudeInstalled).toEqual(
      new Set([
        'agent-device@agent-device-plugin',
        'device-verification@agent-device-plugin',
        'comment-review@comment-review',
        'xlsx@xlsx',
      ]),
    );
    expect(codexInstalled).toEqual(new Set(['xlsx@xlsx']));
    const invocations = calls.map(
      ({ command, args }) => `${command} ${args.join(' ')}`,
    );
    expect(invocations).toContain(
      'claude plugin marketplace add git@github.com:akitorahayashi/xlsx.git#main',
    );
    expect(invocations).toContain(
      'codex plugin marketplace add git@github.com:akitorahayashi/xlsx.git --ref main --json',
    );
    expect(
      invocations.some((call) => call.includes('marketplace update')),
    ).toBe(false);
    expect(
      invocations.some((call) => call.includes('marketplace upgrade')),
    ).toBe(false);
  },
);

sandboxTest(
  'refreshes existing main marketplaces only when plugins are missing',
  async (home) => {
    const catalog = `
marketplaces:
  - clients: [claude]
    repo: akitorahayashi/agent-device-plugin
    plugins: [agent-device, device-verification]
  - clients: [codex]
    repo: akitorahayashi/xlsx
    plugins: [xlsx]
`;
    await deployCatalog(home, catalog);
    const claudeInstalled = new Set(['agent-device@agent-device-plugin']);
    const codexInstalled = new Set<string>();
    const { context, calls } = recordingContext({
      home,
      respond: (command, args) => {
        if (command === 'claude' && args.join(' ') === 'plugin list --json') {
          return ok(claudeInventory([...claudeInstalled]));
        }
        if (
          command === 'claude' &&
          args.join(' ') === 'plugin marketplace list --json'
        ) {
          return ok(
            JSON.stringify([
              {
                name: 'agent-device-plugin',
                source: 'git',
                url: 'git@github.com:akitorahayashi/agent-device-plugin.git',
                ref: 'main',
              },
            ]),
          );
        }
        if (command === 'claude' && args[1] === 'install') {
          claudeInstalled.add(args[2] as string);
          return ok();
        }
        if (command === 'claude' && args[1] === 'marketplace') return ok();
        if (command === 'codex' && args.join(' ') === 'plugin list --json') {
          return ok(codexInventory([...codexInstalled]));
        }
        if (
          command === 'codex' &&
          args.join(' ') === 'plugin marketplace list --json'
        ) {
          return ok(CODEX_XLSX_MARKETPLACES);
        }
        if (
          command === 'codex' &&
          args[1] === 'marketplace' &&
          args[2] === 'add'
        ) {
          return ok(JSON.stringify({ alreadyAdded: true }));
        }
        if (
          command === 'codex' &&
          args[1] === 'marketplace' &&
          args[2] === 'upgrade'
        ) {
          return ok('{}');
        }
        if (command === 'codex' && args[1] === 'add') {
          codexInstalled.add(args[2] as string);
          return ok('{}');
        }
        return fail(`unexpected ${command} ${args.join(' ')}`);
      },
    });

    const report = await run(context);

    expect(report.status).toBe('changed');
    const invocations = calls.map(
      ({ command, args }) => `${command} ${args.join(' ')}`,
    );
    expect(invocations).toContain(
      'claude plugin marketplace update agent-device-plugin',
    );
    expect(invocations).toContain(
      'codex plugin marketplace upgrade xlsx --json',
    );
    expect(invocations).not.toContain(
      'claude plugin install agent-device@agent-device-plugin',
    );
  },
);

sandboxTest(
  'ignores installed plugins outside the Claude user scope',
  async (home) => {
    const catalog = `
marketplaces:
  - clients: [claude]
    repo: akitorahayashi/xlsx
    plugins: [xlsx]
`;
    await deployCatalog(home, catalog);
    const userInstalled = new Set<string>();
    const { context, calls } = recordingContext({
      home,
      respond: (command, args) => {
        if (command === 'claude' && args.join(' ') === 'plugin list --json') {
          return ok(
            JSON.stringify([
              { id: 'xlsx@xlsx', scope: 'project', enabled: true },
              // An install enables the plugin it installed, as the claude CLI
              // does by writing `enabledPlugins`.
              ...[...userInstalled].map((id) => ({
                id,
                scope: 'user',
                enabled: true,
              })),
            ]),
          );
        }
        if (
          command === 'claude' &&
          args.join(' ') === 'plugin marketplace list --json'
        ) {
          return ok(CLAUDE_XLSX_MARKETPLACES);
        }
        if (command === 'claude' && args[1] === 'marketplace') return ok();
        if (command === 'claude' && args[1] === 'install') {
          userInstalled.add(args[2] as string);
          return ok();
        }
        return fail(`unexpected ${command} ${args.join(' ')}`);
      },
    });

    const report = await run(context);

    // The project-scope installation does not satisfy the declaration: mev
    // owns the user scope, so the plugin is installed there.
    expect(report.status).toBe('changed');
    expect(calls.some(({ args }) => args[1] === 'install')).toBe(true);
    expect(userInstalled).toEqual(new Set(['xlsx@xlsx']));
  },
);

sandboxTest(
  'upgrade mode refreshes marketplaces and upgrades installed plugins',
  async (home) => {
    await deployCatalog(home, UPGRADE_CATALOG);
    let claudeVersion = '1.0.0';
    let codexVersion = '0.1.0';
    const { context, calls } = recordingContext({
      home,
      respond: (command, args) => {
        if (command === 'claude' && args.join(' ') === 'plugin list --json') {
          return ok(
            claudeInventory([{ id: 'xlsx@xlsx', version: claudeVersion }]),
          );
        }
        if (
          command === 'claude' &&
          args.join(' ') === 'plugin marketplace list --json'
        ) {
          return ok(CLAUDE_XLSX_MARKETPLACES);
        }
        if (command === 'claude' && args[1] === 'marketplace') return ok();
        if (command === 'claude' && args[1] === 'update') {
          claudeVersion = '1.1.0';
          return ok();
        }
        if (command === 'codex' && args.join(' ') === 'plugin list --json') {
          return ok(
            codexInventory([{ id: 'xlsx@xlsx', version: codexVersion }]),
          );
        }
        if (
          command === 'codex' &&
          args.join(' ') === 'plugin marketplace list --json'
        ) {
          return ok(CODEX_XLSX_MARKETPLACES);
        }
        if (
          command === 'codex' &&
          args[1] === 'marketplace' &&
          args[2] === 'add'
        ) {
          return ok(JSON.stringify({ alreadyAdded: true }));
        }
        if (
          command === 'codex' &&
          args[1] === 'marketplace' &&
          args[2] === 'upgrade'
        ) {
          return ok('{}');
        }
        if (command === 'codex' && args[1] === 'add') {
          codexVersion = '0.2.0';
          return ok('{}');
        }
        return fail(`unexpected ${command} ${args.join(' ')}`);
      },
    });

    const report = await run(context, { upgrade: true });

    expect(report.status).toBe('changed');
    const invocations = calls.map(
      ({ command, args }) => `${command} ${args.join(' ')}`,
    );
    expect(invocations).toContain('claude plugin marketplace update xlsx');
    expect(invocations).toContain('claude plugin update xlsx@xlsx');
    expect(invocations).toContain(
      'codex plugin marketplace upgrade xlsx --json',
    );
    expect(invocations).toContain('codex plugin add xlsx@xlsx --json');
    // The refresh of an existing marketplace is a probe: no entry of its own.
    expect(report.entries?.some(({ key }) => key === 'claude:xlsx')).toBe(
      false,
    );
    expect(report.entries?.some(({ key }) => key === 'codex:xlsx')).toBe(false);
    const claudeEntry = report.entries?.find(
      ({ key }) => key === 'claude:xlsx@xlsx',
    );
    expect(claudeEntry?.status).toBe('changed');
    expect(claudeEntry?.value).toBe('upgraded to 1.1.0');
    const codexEntry = report.entries?.find(
      ({ key }) => key === 'codex:xlsx@xlsx',
    );
    expect(codexEntry?.status).toBe('changed');
    expect(codexEntry?.value).toBe('upgraded to 0.2.0');
  },
);

sandboxTest(
  'upgrade mode reports plugins already at the marketplace version as unchanged',
  async (home) => {
    await deployCatalog(home, UPGRADE_CATALOG);
    const { context } = recordingContext({
      home,
      respond: (command, args) => {
        if (command === 'claude' && args.join(' ') === 'plugin list --json') {
          return ok(claudeInventory([{ id: 'xlsx@xlsx', version: '1.0.0' }]));
        }
        if (
          command === 'claude' &&
          args.join(' ') === 'plugin marketplace list --json'
        ) {
          return ok(CLAUDE_XLSX_MARKETPLACES);
        }
        if (command === 'claude' && args[1] === 'marketplace') return ok();
        if (command === 'claude' && args[1] === 'update') return ok();
        if (command === 'codex' && args.join(' ') === 'plugin list --json') {
          return ok(codexInventory([{ id: 'xlsx@xlsx', version: '0.1.0' }]));
        }
        if (
          command === 'codex' &&
          args.join(' ') === 'plugin marketplace list --json'
        ) {
          return ok(CODEX_XLSX_MARKETPLACES);
        }
        if (
          command === 'codex' &&
          args[1] === 'marketplace' &&
          args[2] === 'add'
        ) {
          return ok(JSON.stringify({ alreadyAdded: true }));
        }
        if (
          command === 'codex' &&
          args[1] === 'marketplace' &&
          args[2] === 'upgrade'
        ) {
          return ok('{}');
        }
        if (command === 'codex' && args[1] === 'add') return ok('{}');
        return fail(`unexpected ${command} ${args.join(' ')}`);
      },
    });

    const report = await run(context, { upgrade: true });

    // With refreshes reported as probes, a run that moved nothing is fully
    // idempotent: the activation itself reports unchanged.
    expect(report.status).toBe('unchanged');
    const claudeEntry = report.entries?.find(
      ({ key }) => key === 'claude:xlsx@xlsx',
    );
    expect(claudeEntry?.status).toBe('unchanged');
    expect(claudeEntry?.value).toBe('already latest (1.0.0)');
    const codexEntry = report.entries?.find(
      ({ key }) => key === 'codex:xlsx@xlsx',
    );
    expect(codexEntry?.status).toBe('unchanged');
    expect(codexEntry?.value).toBe('already latest (0.1.0)');
  },
);

sandboxTest(
  'upgrade mode keeps an upgrade as changed when the client reports no versions',
  async (home) => {
    const catalog = `
marketplaces:
  - clients: [claude]
    repo: akitorahayashi/xlsx
    plugins: [xlsx]
`;
    await deployCatalog(home, catalog);
    const { context } = recordingContext({
      home,
      respond: (command, args) => {
        if (command === 'claude' && args.join(' ') === 'plugin list --json') {
          return ok(claudeInventory(['xlsx@xlsx']));
        }
        if (
          command === 'claude' &&
          args.join(' ') === 'plugin marketplace list --json'
        ) {
          return ok(CLAUDE_XLSX_MARKETPLACES);
        }
        if (command === 'claude' && args[1] === 'marketplace') return ok();
        if (command === 'claude' && args[1] === 'update') return ok();
        return fail(`unexpected ${command} ${args.join(' ')}`);
      },
    });

    const report = await run(context, { upgrade: true });

    const entry = report.entries?.find(({ key }) => key === 'claude:xlsx@xlsx');
    expect(entry?.status).toBe('changed');
    expect(entry?.value).toBe('upgraded');
  },
);

sandboxTest(
  'upgrade mode fails installed plugins when the marketplace refresh fails',
  async (home) => {
    const catalog = `
marketplaces:
  - clients: [claude]
    repo: akitorahayashi/xlsx
    plugins: [xlsx]
`;
    await deployCatalog(home, catalog);
    const { context, calls } = recordingContext({
      home,
      respond: (command, args) => {
        if (command === 'claude' && args.join(' ') === 'plugin list --json') {
          return ok(claudeInventory([{ id: 'xlsx@xlsx', version: '1.0.0' }]));
        }
        if (
          command === 'claude' &&
          args.join(' ') === 'plugin marketplace list --json'
        ) {
          return ok(CLAUDE_XLSX_MARKETPLACES);
        }
        if (command === 'claude' && args[1] === 'marketplace') {
          return fail('offline');
        }
        return fail(`unexpected ${command} ${args.join(' ')}`);
      },
    });

    const report = await run(context, { upgrade: true });

    expect(report.status).toBe('failed');
    const entry = report.entries?.find(({ key }) => key === 'claude:xlsx@xlsx');
    expect(entry?.status).toBe('failed');
    expect(entry?.value).toBe('upgrade blocked');
    expect(calls.some(({ args }) => args[1] === 'update')).toBe(false);
  },
);

sandboxTest(
  'fails a missing plugin when the Claude marketplace source differs',
  async (home) => {
    const catalog = `
marketplaces:
  - clients: [claude]
    repo: akitorahayashi/xlsx
    plugins: [xlsx]
`;
    await deployCatalog(home, catalog);
    const { context, calls } = recordingContext({
      home,
      respond: (command, args) => {
        if (args.join(' ') === 'plugin list --json') return ok('[]');
        if (args.join(' ') === 'plugin marketplace list --json') {
          return ok(
            JSON.stringify([
              {
                name: 'xlsx',
                source: 'git',
                url: 'https://github.com/akitorahayashi/xlsx.git',
                ref: 'main',
              },
            ]),
          );
        }
        return fail(`unexpected ${command} ${args.join(' ')}`);
      },
    });

    const report = await run(context);

    expect(report.status).toBe('failed');
    expect(
      report.entries?.some(({ error }) =>
        error?.includes('different repository'),
      ),
    ).toBe(true);
    expect(calls.some(({ args }) => args[1] === 'install')).toBe(false);
  },
);

const UNINSTALL_CATALOG = `
marketplaces:
  - clients: [claude]
    repo: akitorahayashi/xlsx
    plugins: [xlsx]
    uninstall: [old-tool]
  - clients: [codex]
    repo: akitorahayashi/xlsx
    plugins: [xlsx]
    uninstall: [legacy]
`;

sandboxTest(
  'uninstalls only the listed plugins and converges to already absent',
  async (home) => {
    await deployCatalog(home, UNINSTALL_CATALOG);
    const claudeInstalled = new Set([
      'xlsx@xlsx',
      'old-tool@xlsx',
      'manual@elsewhere',
    ]);
    const codexInstalled = new Set(['xlsx@xlsx', 'legacy@xlsx']);
    const { context, calls } = recordingContext({
      home,
      respond: (command, args) => {
        if (command === 'claude' && args.join(' ') === 'plugin list --json') {
          return ok(claudeInventory([...claudeInstalled]));
        }
        if (
          command === 'claude' &&
          args.join(' ') === 'plugin marketplace list --json'
        ) {
          return ok(CLAUDE_XLSX_MARKETPLACES);
        }
        if (command === 'claude' && args[1] === 'uninstall') {
          claudeInstalled.delete(args[2] as string);
          return ok();
        }
        if (command === 'codex' && args.join(' ') === 'plugin list --json') {
          return ok(codexInventory([...codexInstalled]));
        }
        if (
          command === 'codex' &&
          args.join(' ') === 'plugin marketplace list --json'
        ) {
          return ok(CODEX_XLSX_MARKETPLACES);
        }
        if (command === 'codex' && args[1] === 'remove') {
          codexInstalled.delete(args[2] as string);
          return ok();
        }
        return fail(`unexpected ${command} ${args.join(' ')}`);
      },
    });

    const first = await run(context);

    expect(first.status).toBe('changed');
    const invocations = calls.map(
      ({ command, args }) => `${command} ${args.join(' ')}`,
    );
    expect(invocations).toContain(
      'claude plugin uninstall old-tool@xlsx --scope user',
    );
    expect(invocations).toContain('codex plugin remove legacy@xlsx');
    // Only listed names are removed; declared and unrelated installs survive.
    expect(claudeInstalled).toEqual(new Set(['xlsx@xlsx', 'manual@elsewhere']));
    expect(codexInstalled).toEqual(new Set(['xlsx@xlsx']));
    expect(
      first.entries?.find(({ key }) => key === 'claude:old-tool@xlsx')?.value,
    ).toBe('uninstalled');
    expect(
      first.entries?.find(({ key }) => key === 'claude:xlsx@xlsx')?.value,
    ).toBe('already installed');

    const second = await run(context);

    expect(second.status).toBe('unchanged');
    expect(
      second.entries?.find(({ key }) => key === 'claude:old-tool@xlsx')?.value,
    ).toBe('already absent');
  },
);

sandboxTest(
  'removes a declared marketplace after uninstalling its namespace',
  async (home) => {
    const catalog = `
marketplaces:
  - clients: [claude]
    repo: akitorahayashi/xlsx
    plugins: [xlsx]
removed_marketplaces:
  - clients: [claude]
    repo: akitorahayashi/retired
  - clients: [codex]
    repo: akitorahayashi/retired
`;
    await deployCatalog(home, catalog);
    const claudeInstalled = new Set([
      'xlsx@xlsx',
      'tool-a@retired',
      'tool-b@retired',
    ]);
    const codexInstalled = new Set(['tool-c@retired']);
    let claudeRegistered = ['retired', 'xlsx'];
    let codexRegistered = ['retired'];
    const { context, calls } = recordingContext({
      home,
      respond: (command, args) => {
        if (command === 'claude' && args.join(' ') === 'plugin list --json') {
          return ok(claudeInventory([...claudeInstalled]));
        }
        if (
          command === 'claude' &&
          args.join(' ') === 'plugin marketplace list --json'
        ) {
          return ok(
            JSON.stringify(
              claudeRegistered.map((name) => ({
                name,
                source: 'git',
                url: `git@github.com:akitorahayashi/${name}.git`,
                ref: 'main',
              })),
            ),
          );
        }
        if (command === 'claude' && args[1] === 'uninstall') {
          claudeInstalled.delete(args[2] as string);
          return ok();
        }
        if (
          command === 'claude' &&
          args[1] === 'marketplace' &&
          args[2] === 'remove'
        ) {
          claudeRegistered = claudeRegistered.filter(
            (name) => name !== args[3],
          );
          return ok();
        }
        if (command === 'codex' && args.join(' ') === 'plugin list --json') {
          return ok(codexInventory([...codexInstalled]));
        }
        if (
          command === 'codex' &&
          args.join(' ') === 'plugin marketplace list --json'
        ) {
          return ok(
            JSON.stringify({
              marketplaces: codexRegistered.map((name) => ({
                name,
                marketplaceSource: {
                  sourceType: 'git',
                  source: `git@github.com:akitorahayashi/${name}.git`,
                },
              })),
            }),
          );
        }
        if (command === 'codex' && args[1] === 'remove') {
          codexInstalled.delete(args[2] as string);
          return ok();
        }
        if (
          command === 'codex' &&
          args[1] === 'marketplace' &&
          args[2] === 'remove'
        ) {
          codexRegistered = codexRegistered.filter((name) => name !== args[3]);
          return ok('{}');
        }
        return fail(`unexpected ${command} ${args.join(' ')}`);
      },
    });

    const first = await run(context);

    expect(first.status).toBe('changed');
    const invocations = calls.map(
      ({ command, args }) => `${command} ${args.join(' ')}`,
    );
    // Namespace plugins are uninstalled before the marketplace is removed.
    expect(
      invocations.indexOf(
        'claude plugin uninstall tool-a@retired --scope user',
      ),
    ).toBeLessThan(
      invocations.indexOf(
        'claude plugin marketplace remove retired --scope user',
      ),
    );
    expect(invocations).toContain(
      'claude plugin uninstall tool-b@retired --scope user',
    );
    expect(
      invocations.indexOf('codex plugin remove tool-c@retired'),
    ).toBeLessThan(
      invocations.indexOf('codex plugin marketplace remove retired --json'),
    );
    expect(claudeInstalled).toEqual(new Set(['xlsx@xlsx']));
    expect(
      first.entries?.find(({ key }) => key === 'claude:retired')?.value,
    ).toBe('marketplace removed');
    expect(
      first.entries?.find(({ key }) => key === 'codex:retired')?.value,
    ).toBe('marketplace removed');

    const second = await run(context);

    expect(second.status).toBe('unchanged');
    expect(
      second.entries?.find(({ key }) => key === 'claude:retired')?.value,
    ).toBe('marketplace already absent');
  },
);

sandboxTest(
  'removes a marketplace registered under a previous SSH host alias',
  async (home) => {
    const catalog = `
marketplaces: []
removed_marketplaces:
  - clients: [claude]
    repo: akitorahayashi/retired
`;
    await deployCatalog(home, catalog);
    let registered = true;
    const { context, calls } = recordingContext({
      home,
      respond: (command, args) => {
        if (command === 'claude' && args.join(' ') === 'plugin list --json') {
          return ok(claudeInventory([]));
        }
        if (
          command === 'claude' &&
          args.join(' ') === 'plugin marketplace list --json'
        ) {
          // Registered while `mev config ssh-host` named a different alias.
          return ok(
            registered
              ? JSON.stringify([
                  {
                    name: 'retired',
                    source: 'git',
                    url: 'git@github-personal:akitorahayashi/retired.git',
                    ref: 'main',
                  },
                ])
              : '[]',
          );
        }
        if (
          command === 'claude' &&
          args[1] === 'marketplace' &&
          args[2] === 'remove'
        ) {
          registered = false;
          return ok();
        }
        return fail(`unexpected ${command} ${args.join(' ')}`);
      },
    });

    const report = await run(context);

    expect(report.status).toBe('changed');
    expect(
      calls.map(({ command, args }) => `${command} ${args.join(' ')}`),
    ).toContain('claude plugin marketplace remove retired --scope user');
    expect(
      report.entries?.find(({ key }) => key === 'claude:retired')?.value,
    ).toBe('marketplace removed');
  },
);

sandboxTest(
  're-registers a marketplace registered under a previous SSH host alias',
  async (home) => {
    const catalog = `
marketplaces:
  - clients: [claude]
    repo: akitorahayashi/xlsx
    plugins: [xlsx]
`;
    await deployCatalog(home, catalog);
    const installed = new Set<string>();
    const { context, calls } = recordingContext({
      home,
      respond: (command, args) => {
        if (command === 'claude' && args.join(' ') === 'plugin list --json') {
          return ok(claudeInventory([...installed]));
        }
        if (
          command === 'claude' &&
          args.join(' ') === 'plugin marketplace list --json'
        ) {
          return ok(
            JSON.stringify([
              {
                name: 'xlsx',
                source: 'git',
                url: 'git@github-personal:akitorahayashi/xlsx.git',
                ref: 'main',
              },
            ]),
          );
        }
        if (command === 'claude' && args[1] === 'marketplace') return ok();
        if (command === 'claude' && args[1] === 'install') {
          installed.add(args[2] as string);
          return ok();
        }
        return fail(`unexpected ${command} ${args.join(' ')}`);
      },
    });

    const report = await run(context);

    // The alias is transport, not identity: the same repository under a stale
    // alias is still mev's registration, so it converges to the declared
    // source by re-registration rather than failing as a conflict or fetching
    // through the stale alias forever.
    expect(report.status).toBe('changed');
    const invocations = calls.map(
      ({ command, args }) => `${command} ${args.join(' ')}`,
    );
    // `marketplace add` rewrites an existing registration's source in place,
    // so convergence involves no removal and no refresh.
    expect(invocations).toContain(
      'claude plugin marketplace add git@github.com:akitorahayashi/xlsx.git#main',
    );
    expect(
      invocations.some(
        (call) =>
          call.includes('marketplace remove') ||
          call.includes('marketplace update'),
      ),
    ).toBe(false);
    expect(
      report.entries?.find(({ key }) => key === 'claude:xlsx')?.value,
    ).toBe('marketplace re-registered from main');
    expect(installed).toEqual(new Set(['xlsx@xlsx']));
  },
);

sandboxTest(
  're-registers a marketplace recorded without the ref pin and keeps its plugins',
  async (home) => {
    const catalog = `
marketplaces:
  - clients: [claude]
    repo: akitorahayashi/comment-review
    plugins: [comment-review]
`;
    await deployCatalog(home, catalog);
    // Registered before mev pinned #main: the URL matches but no ref was
    // recorded. `marketplace add` rewrites the registration in place and the
    // installed plugin survives it.
    let ref: string | undefined;
    const installed = new Set(['comment-review@comment-review']);
    const { context, calls } = recordingContext({
      home,
      respond: (command, args) => {
        if (command === 'claude' && args.join(' ') === 'plugin list --json') {
          return ok(claudeInventory([...installed]));
        }
        if (
          command === 'claude' &&
          args.join(' ') === 'plugin marketplace list --json'
        ) {
          return ok(
            JSON.stringify([
              {
                name: 'comment-review',
                source: 'git',
                url: 'git@github.com:akitorahayashi/comment-review.git',
                ...(ref === undefined ? {} : { ref }),
              },
            ]),
          );
        }
        if (
          command === 'claude' &&
          args[1] === 'marketplace' &&
          args[2] === 'add'
        ) {
          ref = 'main';
          return ok();
        }
        return fail(`unexpected ${command} ${args.join(' ')}`);
      },
    });

    const report = await run(context);

    expect(report.status).toBe('changed');
    expect(
      report.entries?.find(({ key }) => key === 'claude:comment-review')?.value,
    ).toBe('marketplace re-registered from main');
    // The plugin survives the in-place rewrite, so nothing is reinstalled.
    expect(
      report.entries?.find(
        ({ key }) => key === 'claude:comment-review@comment-review',
      ),
    ).toMatchObject({ value: 'already installed', status: 'unchanged' });
    expect(calls.some(({ args }) => args[1] === 'install')).toBe(false);

    // Converged: the pinned registration now matches and the run holds still.
    const second = await run(context);
    expect(second.status).toBe('unchanged');
  },
);

sandboxTest(
  're-registers a codex marketplace whose recorded source drifted',
  async (home) => {
    const catalog = `
marketplaces:
  - clients: [codex]
    repo: akitorahayashi/xlsx
    plugins: [xlsx]
`;
    await deployCatalog(home, catalog);
    let registered = true;
    let source = 'git@github-personal:akitorahayashi/xlsx.git';
    const installed = new Set(['xlsx@xlsx']);
    const { context, calls } = recordingContext({
      home,
      respond: (command, args) => {
        if (command === 'codex' && args.join(' ') === 'plugin list --json') {
          return ok(codexInventory([...installed]));
        }
        if (
          command === 'codex' &&
          args.join(' ') === 'plugin marketplace list --json'
        ) {
          return ok(
            JSON.stringify({
              marketplaces: registered
                ? [
                    {
                      name: 'xlsx',
                      marketplaceSource: { sourceType: 'git', source },
                    },
                  ]
                : [],
            }),
          );
        }
        // Removal uninstalls the marketplace's plugins, as the codex CLI does.
        if (
          command === 'codex' &&
          args[1] === 'marketplace' &&
          args[2] === 'remove'
        ) {
          registered = false;
          installed.delete('xlsx@xlsx');
          return ok('{}');
        }
        if (
          command === 'codex' &&
          args[1] === 'marketplace' &&
          args[2] === 'add'
        ) {
          // codex refuses a name already held from a different source.
          if (registered && source !== args[3]) {
            return fail('already added from a different source');
          }
          registered = true;
          source = args[3] as string;
          return ok(JSON.stringify({ alreadyAdded: false }));
        }
        if (command === 'codex' && args[1] === 'add') {
          installed.add(args[2] as string);
          return ok('{}');
        }
        return fail(`unexpected ${command} ${args.join(' ')}`);
      },
    });

    const report = await run(context);

    expect(report.status).toBe('changed');
    const invocations = calls.map(
      ({ command, args }) => `${command} ${args.join(' ')}`,
    );
    expect(invocations).toContain(
      'codex plugin marketplace remove xlsx --json',
    );
    expect(report.entries?.find(({ key }) => key === 'codex:xlsx')?.value).toBe(
      'marketplace re-registered from main',
    );
    expect(source).toBe('git@github.com:akitorahayashi/xlsx.git');
    // The removal took the plugin with it, so it is reinstalled from the
    // re-registered source rather than left missing.
    expect(
      report.entries?.find(({ key }) => key === 'codex:xlsx@xlsx'),
    ).toMatchObject({ value: 'installed', status: 'changed' });
    expect(installed).toEqual(new Set(['xlsx@xlsx']));
  },
);

sandboxTest(
  'a codex re-registration whose add fails reports the dropped plugins as blocked',
  async (home) => {
    const catalog = `
marketplaces:
  - clients: [codex]
    repo: akitorahayashi/xlsx
    plugins: [xlsx]
`;
    await deployCatalog(home, catalog);
    let registered = true;
    let source = 'git@github-personal:akitorahayashi/xlsx.git';
    let addFails = true;
    const installed = new Set(['xlsx@xlsx']);
    const { context } = recordingContext({
      home,
      respond: (command, args) => {
        if (command === 'codex' && args.join(' ') === 'plugin list --json') {
          return ok(codexInventory([...installed]));
        }
        if (
          command === 'codex' &&
          args.join(' ') === 'plugin marketplace list --json'
        ) {
          return ok(
            JSON.stringify({
              marketplaces: registered
                ? [
                    {
                      name: 'xlsx',
                      marketplaceSource: { sourceType: 'git', source },
                    },
                  ]
                : [],
            }),
          );
        }
        if (
          command === 'codex' &&
          args[1] === 'marketplace' &&
          args[2] === 'remove'
        ) {
          registered = false;
          installed.delete('xlsx@xlsx');
          return ok('{}');
        }
        if (
          command === 'codex' &&
          args[1] === 'marketplace' &&
          args[2] === 'add'
        ) {
          if (addFails) return fail('ssh: connection refused');
          registered = true;
          source = args[3] as string;
          return ok(JSON.stringify({ alreadyAdded: false }));
        }
        if (command === 'codex' && args[1] === 'add') {
          installed.add(args[2] as string);
          return ok('{}');
        }
        return fail(`unexpected ${command} ${args.join(' ')}`);
      },
    });

    const first = await run(context);

    // The removal destroyed the namespace before the add failed, so the
    // plugin must not surface as 'already installed' off the pre-run
    // inventory: it is gone from the host and blocked by the failure.
    expect(first.status).toBe('failed');
    expect(
      first.entries?.find(({ key }) => key === 'codex:xlsx@xlsx'),
    ).toMatchObject({ value: 'install blocked', status: 'failed' });
    expect(
      first.entries?.find(({ key }) => key === 'codex:xlsx')?.error,
    ).toContain('uninstalling its plugins');
    expect(installed.size).toBe(0);

    // A later run finds no registration, adds the declared source, and
    // reinstalls: the destructive partial failure heals.
    addFails = false;
    const second = await run(context);
    expect(second.status).toBe('changed');
    expect(installed).toEqual(new Set(['xlsx@xlsx']));
    expect(source).toBe('git@github.com:akitorahayashi/xlsx.git');
  },
);

sandboxTest(
  'refuses to remove a same-named marketplace from another source',
  async (home) => {
    const catalog = `
marketplaces: []
removed_marketplaces:
  - clients: [claude]
    repo: akitorahayashi/retired
  - clients: [codex]
    repo: akitorahayashi/curated
    name: openai-curated
`;
    await deployCatalog(home, catalog);
    const { context, calls } = recordingContext({
      home,
      respond: (command, args) => {
        if (command === 'claude' && args.join(' ') === 'plugin list --json') {
          return ok(claudeInventory(['tool-a@retired']));
        }
        if (
          command === 'claude' &&
          args.join(' ') === 'plugin marketplace list --json'
        ) {
          return ok(
            JSON.stringify([
              {
                name: 'retired',
                source: 'git',
                url: 'git@github.com:someone-else/retired.git',
                ref: 'main',
              },
            ]),
          );
        }
        if (command === 'codex' && args.join(' ') === 'plugin list --json') {
          return ok(codexInventory([]));
        }
        if (
          command === 'codex' &&
          args.join(' ') === 'plugin marketplace list --json'
        ) {
          // A built-in marketplace reports no marketplaceSource at all.
          return ok(
            JSON.stringify({ marketplaces: [{ name: 'openai-curated' }] }),
          );
        }
        return fail(`unexpected ${command} ${args.join(' ')}`);
      },
    });

    const report = await run(context);

    // Nothing in a foreign marketplace's namespace is touched.
    expect(report.status).toBe('failed');
    expect(calls.some(({ args }) => args[1] === 'uninstall')).toBe(false);
    expect(
      calls.some(
        ({ args }) => args[1] === 'marketplace' && args[2] === 'remove',
      ),
    ).toBe(false);
    const claudeEntry = report.entries?.find(
      ({ key }) => key === 'claude:retired',
    );
    expect(claudeEntry?.value).toBe('marketplace removal refused');
    expect(claudeEntry?.error).toContain('different source');
    expect(
      report.entries?.find(({ key }) => key === 'codex:openai-curated')?.value,
    ).toBe('marketplace removal refused');
  },
);

sandboxTest(
  'fails an uninstall whose plugin survives the post-run inventory',
  async (home) => {
    const catalog = `
marketplaces:
  - clients: [claude]
    repo: akitorahayashi/xlsx
    plugins: [xlsx]
    uninstall: [old-tool]
`;
    await deployCatalog(home, catalog);
    const { context } = recordingContext({
      home,
      respond: (command, args) => {
        if (command === 'claude' && args.join(' ') === 'plugin list --json') {
          return ok(claudeInventory(['xlsx@xlsx', 'old-tool@xlsx']));
        }
        if (
          command === 'claude' &&
          args.join(' ') === 'plugin marketplace list --json'
        ) {
          return ok(CLAUDE_XLSX_MARKETPLACES);
        }
        // The uninstall reports success but the inventory never changes.
        if (command === 'claude' && args[1] === 'uninstall') return ok();
        return fail(`unexpected ${command} ${args.join(' ')}`);
      },
    });

    const report = await run(context);

    expect(report.status).toBe('failed');
    const entry = report.entries?.find(
      ({ key }) => key === 'claude:old-tool@xlsx',
    );
    expect(entry?.value).toBe('verification failed');
    expect(entry?.error).toContain('still present');
  },
);

sandboxTest(
  'uninstalls listed plugins even when the marketplace is unreachable',
  async (home) => {
    const catalog = `
marketplaces:
  - clients: [claude]
    repo: akitorahayashi/xlsx
    plugins: [xlsx]
    uninstall: [old-tool]
`;
    await deployCatalog(home, catalog);
    const claudeInstalled = new Set(['old-tool@xlsx']);
    const { context, calls } = recordingContext({
      home,
      respond: (command, args) => {
        if (command === 'claude' && args.join(' ') === 'plugin list --json') {
          return ok(claudeInventory([...claudeInstalled]));
        }
        if (command === 'claude' && args[1] === 'uninstall') {
          claudeInstalled.delete(args[2] as string);
          return ok();
        }
        if (
          command === 'claude' &&
          args.join(' ') === 'plugin marketplace list --json'
        ) {
          return fail('offline');
        }
        return fail(`unexpected ${command} ${args.join(' ')}`);
      },
    });

    const report = await run(context);

    // The install of the missing declared plugin fails offline, but the
    // local-only uninstall still converges.
    expect(report.status).toBe('failed');
    expect(calls.map(({ args }) => args[1])).toContain('uninstall');
    expect(
      report.entries?.find(({ key }) => key === 'claude:old-tool@xlsx')?.value,
    ).toBe('uninstalled');
    expect(
      report.entries?.find(({ key }) => key === 'claude:xlsx@xlsx')?.value,
    ).toBe('install blocked');
  },
);

sandboxTest(
  'keeps a marketplace registered when its plugins survive a clean uninstall',
  async (home) => {
    const catalog = `
marketplaces: []
removed_marketplaces:
  - clients: [claude]
    repo: akitorahayashi/retired
`;
    await deployCatalog(home, catalog);
    const { context, calls } = recordingContext({
      home,
      respond: (command, args) => {
        if (command === 'claude' && args.join(' ') === 'plugin list --json') {
          return ok(claudeInventory(['tool-a@retired']));
        }
        if (
          command === 'claude' &&
          args.join(' ') === 'plugin marketplace list --json'
        ) {
          return ok(
            JSON.stringify([
              {
                name: 'retired',
                source: 'git',
                url: 'git@github.com:akitorahayashi/retired.git',
                ref: 'main',
              },
            ]),
          );
        }
        // The uninstall exits cleanly but the plugin is still installed.
        if (command === 'claude' && args[1] === 'uninstall') return ok();
        return fail(`unexpected ${command} ${args.join(' ')}`);
      },
    });

    const report = await run(context);

    expect(report.status).toBe('failed');
    expect(
      calls.some(
        ({ args }) => args[1] === 'marketplace' && args[2] === 'remove',
      ),
    ).toBe(false);
    expect(
      report.entries?.find(({ key }) => key === 'claude:tool-a@retired')?.value,
    ).toBe('verification failed');
    expect(
      report.entries?.find(({ key }) => key === 'claude:retired')?.value,
    ).toBe('marketplace removal blocked');
  },
);
