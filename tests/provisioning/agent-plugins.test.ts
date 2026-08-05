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
source:
  owner: akitorahayashi
  default_ssh_host: github.com
marketplaces:
  - client: claude
    repository: agent-device-plugin
    name: agent-device-plugin
    plugins: [agent-device, device-verification]
  - client: claude
    repository: comment-review
    name: comment-review
    plugins: [comment-review]
  - client: claude
    repository: xlsx
    name: xlsx
    plugins: [xlsx]
  - client: codex
    repository: xlsx
    name: xlsx
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
  return JSON.stringify(ids.map((id) => ({ id, enabled: false })));
}

function codexInventory(ids: readonly string[]): string {
  return JSON.stringify({
    installed: ids.map((pluginId) => ({ pluginId, enabled: false })),
    available: [],
  });
}

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
source:
  owner: akitorahayashi
  default_ssh_host: github.com
marketplaces:
  - client: claude
    repository: agent-device-plugin
    name: agent-device-plugin
    plugins: [agent-device, device-verification]
  - client: codex
    repository: xlsx
    name: xlsx
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
  'fails a missing plugin when the Claude marketplace source differs',
  async (home) => {
    const catalog = `
source:
  owner: akitorahayashi
  default_ssh_host: github.com
marketplaces:
  - client: claude
    repository: xlsx
    name: xlsx
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
