import { expect } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  installAgentPlugins,
  runActivation,
} from '../../src/provisioning/activation';
import { fail, ok } from '../fixtures/fake-command-runner';
import { recordingContext } from '../fixtures/fake-context';
import { sandboxedTest } from '../fixtures/temporary-directory';

const CONFIG_KEY = 'coder/plugins.yml';
const FULL_CATALOG = `
marketplaces:
  - client: claude
    repo: akitorahayashi/agent-device-plugin
    plugins: [agent-device, device-verification]
  - client: claude
    repo: akitorahayashi/comment-review
    plugins: [comment-review]
  - client: claude
    repo: akitorahayashi/xlsx
    plugins: [xlsx]
  - client: codex
    repo: akitorahayashi/xlsx
    plugins: [xlsx]
`;

const sandboxTest = sandboxedTest('agent-plugins-');

async function deployCatalog(
  home: string,
  catalog = FULL_CATALOG,
): Promise<void> {
  const directory = join(home, '.mev/roles/coder');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'plugins.yml'), catalog);
}

function claudeInventory(ids: readonly string[]): string {
  return JSON.stringify(
    ids.map((id) => ({ id, scope: 'user', enabled: false })),
  );
}

function codexInventory(ids: readonly string[]): string {
  return JSON.stringify({
    installed: ids.map((pluginId) => ({ pluginId, enabled: false })),
    available: [],
  });
}

function claudeVersionedInventory(
  plugins: Readonly<Record<string, string>>,
): string {
  return JSON.stringify(
    Object.entries(plugins).map(([id, version]) => ({
      id,
      version,
      scope: 'user',
      enabled: true,
    })),
  );
}

function codexVersionedInventory(
  plugins: Readonly<Record<string, string>>,
): string {
  return JSON.stringify({
    installed: Object.entries(plugins).map(([pluginId, version]) => ({
      pluginId,
      version,
      enabled: true,
    })),
    available: [],
  });
}

const UPDATE_CATALOG = `
marketplaces:
  - client: claude
    repo: akitorahayashi/xlsx
    plugins: [xlsx]
  - client: codex
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

sandboxTest(
  'skips every marketplace operation when all plugins are installed',
  async (home) => {
    await deployCatalog(home);
    const { context, calls } = recordingContext({
      home,
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
        if (command === 'codex' && args.join(' ') === 'plugin list --json') {
          return ok(codexInventory(['xlsx@xlsx']));
        }
        return fail(`unexpected ${command} ${args.join(' ')}`);
      },
    });

    const report = await runActivation(
      installAgentPlugins(CONFIG_KEY),
      context,
    );

    expect(report.status).toBe('unchanged');
    expect(
      calls.map(({ command, args }) => `${command} ${args.join(' ')}`),
    ).toEqual(['claude plugin list --json', 'codex plugin list --json']);
    expect(
      report.entries?.every(({ value }) => value === 'already installed'),
    ).toBe(true);
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

    const report = await runActivation(
      installAgentPlugins(CONFIG_KEY),
      context,
    );

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
  - client: claude
    repo: akitorahayashi/agent-device-plugin
    plugins: [agent-device, device-verification]
  - client: codex
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

    const report = await runActivation(
      installAgentPlugins(CONFIG_KEY),
      context,
    );

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
  - client: claude
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
              ...[...userInstalled].map((id) => ({
                id,
                scope: 'user',
                enabled: false,
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

    const report = await runActivation(
      installAgentPlugins(CONFIG_KEY),
      context,
    );

    // The project-scope installation does not satisfy the declaration: mev
    // owns the user scope, so the plugin is installed there.
    expect(report.status).toBe('changed');
    expect(calls.some(({ args }) => args[1] === 'install')).toBe(true);
    expect(userInstalled).toEqual(new Set(['xlsx@xlsx']));
  },
);

sandboxTest(
  'update mode refreshes marketplaces and updates installed plugins',
  async (home) => {
    await deployCatalog(home, UPDATE_CATALOG);
    let claudeVersion = '1.0.0';
    let codexVersion = '0.1.0';
    const { context, calls } = recordingContext({
      home,
      respond: (command, args) => {
        if (command === 'claude' && args.join(' ') === 'plugin list --json') {
          return ok(claudeVersionedInventory({ 'xlsx@xlsx': claudeVersion }));
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
          return ok(codexVersionedInventory({ 'xlsx@xlsx': codexVersion }));
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

    const report = await runActivation(
      installAgentPlugins(CONFIG_KEY),
      context,
      { update: true },
    );

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
    expect(claudeEntry?.value).toBe('updated to 1.1.0');
    const codexEntry = report.entries?.find(
      ({ key }) => key === 'codex:xlsx@xlsx',
    );
    expect(codexEntry?.status).toBe('changed');
    expect(codexEntry?.value).toBe('updated to 0.2.0');
  },
);

sandboxTest(
  'update mode reports plugins already at the marketplace version as unchanged',
  async (home) => {
    await deployCatalog(home, UPDATE_CATALOG);
    const { context } = recordingContext({
      home,
      respond: (command, args) => {
        if (command === 'claude' && args.join(' ') === 'plugin list --json') {
          return ok(claudeVersionedInventory({ 'xlsx@xlsx': '1.0.0' }));
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
          return ok(codexVersionedInventory({ 'xlsx@xlsx': '0.1.0' }));
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

    const report = await runActivation(
      installAgentPlugins(CONFIG_KEY),
      context,
      { update: true },
    );

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
  'update mode keeps an update as changed when the client reports no versions',
  async (home) => {
    const catalog = `
marketplaces:
  - client: claude
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

    const report = await runActivation(
      installAgentPlugins(CONFIG_KEY),
      context,
      { update: true },
    );

    const entry = report.entries?.find(({ key }) => key === 'claude:xlsx@xlsx');
    expect(entry?.status).toBe('changed');
    expect(entry?.value).toBe('updated');
  },
);

sandboxTest(
  'update mode fails installed plugins when the marketplace refresh fails',
  async (home) => {
    const catalog = `
marketplaces:
  - client: claude
    repo: akitorahayashi/xlsx
    plugins: [xlsx]
`;
    await deployCatalog(home, catalog);
    const { context, calls } = recordingContext({
      home,
      respond: (command, args) => {
        if (command === 'claude' && args.join(' ') === 'plugin list --json') {
          return ok(claudeVersionedInventory({ 'xlsx@xlsx': '1.0.0' }));
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

    const report = await runActivation(
      installAgentPlugins(CONFIG_KEY),
      context,
      { update: true },
    );

    expect(report.status).toBe('failed');
    const entry = report.entries?.find(({ key }) => key === 'claude:xlsx@xlsx');
    expect(entry?.status).toBe('failed');
    expect(entry?.value).toBe('update blocked');
    expect(calls.some(({ args }) => args[1] === 'update')).toBe(false);
  },
);

sandboxTest(
  'fails a missing plugin when the Claude marketplace source differs',
  async (home) => {
    const catalog = `
marketplaces:
  - client: claude
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

    const report = await runActivation(
      installAgentPlugins(CONFIG_KEY),
      context,
    );

    expect(report.status).toBe('failed');
    expect(
      report.entries?.some(({ error }) => error?.includes('different source')),
    ).toBe(true);
    expect(calls.some(({ args }) => args[1] === 'install')).toBe(false);
  },
);

const UNINSTALL_CATALOG = `
marketplaces:
  - client: claude
    repo: akitorahayashi/xlsx
    plugins: [xlsx]
    uninstall: [old-tool]
  - client: codex
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
        if (command === 'claude' && args[1] === 'uninstall') {
          claudeInstalled.delete(args[2] as string);
          return ok();
        }
        if (command === 'codex' && args.join(' ') === 'plugin list --json') {
          return ok(codexInventory([...codexInstalled]));
        }
        if (command === 'codex' && args[1] === 'remove') {
          codexInstalled.delete(args[2] as string);
          return ok();
        }
        return fail(`unexpected ${command} ${args.join(' ')}`);
      },
    });

    const first = await runActivation(installAgentPlugins(CONFIG_KEY), context);

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

    const second = await runActivation(
      installAgentPlugins(CONFIG_KEY),
      context,
    );

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
  - client: claude
    repo: akitorahayashi/xlsx
    plugins: [xlsx]
removed_marketplaces:
  - client: claude
    repo: akitorahayashi/retired
  - client: codex
    repo: akitorahayashi/retired
`;
    await deployCatalog(home, catalog);
    const claudeInstalled = new Set([
      'xlsx@xlsx',
      'tool-a@retired',
      'tool-b@retired',
    ]);
    const codexInstalled = new Set(['tool-c@retired']);
    let claudeRegistered = ['retired'];
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

    const first = await runActivation(installAgentPlugins(CONFIG_KEY), context);

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

    const second = await runActivation(
      installAgentPlugins(CONFIG_KEY),
      context,
    );

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
  - client: claude
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

    const report = await runActivation(
      installAgentPlugins(CONFIG_KEY),
      context,
    );

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
  'refreshes a marketplace registered under a previous SSH host alias',
  async (home) => {
    const catalog = `
marketplaces:
  - client: claude
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

    const report = await runActivation(
      installAgentPlugins(CONFIG_KEY),
      context,
    );

    // The alias is transport, not identity: the registration is still mev's,
    // so the missing plugin installs instead of failing on a source conflict.
    expect(report.status).toBe('changed');
    expect(
      calls.map(({ command, args }) => `${command} ${args.join(' ')}`),
    ).toContain('claude plugin marketplace update xlsx');
    expect(installed).toEqual(new Set(['xlsx@xlsx']));
  },
);

sandboxTest(
  'refuses to remove a same-named marketplace from another source',
  async (home) => {
    const catalog = `
marketplaces: []
removed_marketplaces:
  - client: claude
    repo: akitorahayashi/retired
  - client: codex
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

    const report = await runActivation(
      installAgentPlugins(CONFIG_KEY),
      context,
    );

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
  - client: claude
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
        // The uninstall reports success but the inventory never changes.
        if (command === 'claude' && args[1] === 'uninstall') return ok();
        return fail(`unexpected ${command} ${args.join(' ')}`);
      },
    });

    const report = await runActivation(
      installAgentPlugins(CONFIG_KEY),
      context,
    );

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
  - client: claude
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

    const report = await runActivation(
      installAgentPlugins(CONFIG_KEY),
      context,
    );

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
  - client: claude
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

    const report = await runActivation(
      installAgentPlugins(CONFIG_KEY),
      context,
    );

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
