import { expect, test } from 'bun:test';
import { marketplaceSshUrl, parsePluginCatalog, pluginId } from './catalog';

const VALID = `
source:
  owner: akitorahayashi
  default_ssh_host: github.com
marketplaces:
  - client: claude
    repository: agent-device-plugin
    name: agent-device-plugin
    plugins: [agent-device, device-verification]
    uninstall: []
  - client: codex
    repository: xlsx
    name: xlsx
    plugins: [xlsx]
    uninstall: [legacy-tool]
removed_marketplaces:
  - client: claude
    name: retired
`;

test('parsePluginCatalog preserves declared marketplace and plugin order', () => {
  const catalog = parsePluginCatalog(VALID, 'plugins.yml');

  expect(catalog.source).toEqual({
    owner: 'akitorahayashi',
    defaultSshHost: 'github.com',
  });
  expect(
    catalog.marketplaces.map(({ client, plugins }) => [client, plugins]),
  ).toEqual([
    ['claude', ['agent-device', 'device-verification']],
    ['codex', ['xlsx']],
  ]);
  expect(catalog.marketplaces.map(({ uninstall }) => uninstall)).toEqual([
    [],
    ['legacy-tool'],
  ]);
  expect(catalog.removedMarketplaces).toEqual([
    { client: 'claude', name: 'retired' },
  ]);
});

test('parsePluginCatalog rejects duplicate plugin identities per client', () => {
  expect(() =>
    parsePluginCatalog(
      VALID.replace(
        'plugins: [xlsx]',
        'plugins: [xlsx]\n    uninstall: []\n  - client: codex\n    repository: other\n    name: other\n    plugins: [xlsx]',
      ),
      'plugins.yml',
    ),
  ).toThrow(/duplicate 'codex:xlsx'/);
});

test('parsePluginCatalog rejects a missing uninstall list', () => {
  expect(() =>
    parsePluginCatalog(VALID.replace('    uninstall: []\n', ''), 'plugins.yml'),
  ).toThrow(/uninstall must be a sequence/);
});

test('parsePluginCatalog rejects a name declared in both plugins and uninstall', () => {
  expect(() =>
    parsePluginCatalog(
      VALID.replace('uninstall: [legacy-tool]', 'uninstall: [xlsx]'),
      'plugins.yml',
    ),
  ).toThrow(/duplicate 'xlsx'/);
});

test('parsePluginCatalog rejects a missing removed_marketplaces list', () => {
  const withoutRemoved = VALID.slice(0, VALID.indexOf('removed_marketplaces'));
  expect(() => parsePluginCatalog(withoutRemoved, 'plugins.yml')).toThrow(
    /removed_marketplaces must be a sequence/,
  );
});

test('parsePluginCatalog rejects a removed marketplace still declared active', () => {
  expect(() =>
    parsePluginCatalog(
      VALID.replace('name: retired', 'name: xlsx').replace(
        'client: claude\n    name: xlsx',
        'client: codex\n    name: xlsx',
      ),
      'plugins.yml',
    ),
  ).toThrow(/'codex:xlsx', which is still declared/);
});

for (const unsafe of ['github.com/work', 'git@github.com', '-alias', '']) {
  test(`parsePluginCatalog rejects unsafe SSH host ${JSON.stringify(unsafe)}`, () => {
    expect(() =>
      parsePluginCatalog(
        VALID.replace('github.com', JSON.stringify(unsafe)),
        'plugins.yml',
      ),
    ).toThrow(/default_ssh_host/);
  });
}

test('plugin source values are derived from catalog identities', () => {
  expect(pluginId('xlsx', 'xlsx')).toBe('xlsx@xlsx');
  expect(marketplaceSshUrl('github-personal', 'owner', 'repo')).toBe(
    'git@github-personal:owner/repo.git',
  );
});
