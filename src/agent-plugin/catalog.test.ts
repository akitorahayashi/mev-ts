import { expect, test } from 'bun:test';
import { parsePluginCatalog, pluginId } from './catalog';

const VALID = `
marketplaces:
  - clients: [claude]
    repo: akitorahayashi/agent-device-plugin
    plugins: [agent-device, device-verification]
  - clients: [claude, codex]
    repo: akitorahayashi/xlsx
    plugins: [xlsx]
    uninstall: [legacy-tool]
removed_marketplaces:
  - clients: [claude]
    repo: akitorahayashi/retired
`;

test('parsePluginCatalog expands entries per client in declared order', () => {
  const catalog = parsePluginCatalog(VALID, 'plugins.yml');

  expect(
    catalog.marketplaces.map(({ client, plugins }) => [client, plugins]),
  ).toEqual([
    ['claude', ['agent-device', 'device-verification']],
    ['claude', ['xlsx']],
    ['codex', ['xlsx']],
  ]);
  expect(catalog.marketplaces.map(({ uninstall }) => uninstall)).toEqual([
    [],
    ['legacy-tool'],
    ['legacy-tool'],
  ]);
  expect(catalog.removedMarketplaces).toEqual([
    {
      client: 'claude',
      repo: { owner: 'akitorahayashi', name: 'retired' },
      name: 'retired',
    },
  ]);
});

test('parsePluginCatalog derives the marketplace name from the repo', () => {
  const catalog = parsePluginCatalog(VALID, 'plugins.yml');

  expect(catalog.marketplaces.map(({ repo, name }) => [repo, name])).toEqual([
    [
      { owner: 'akitorahayashi', name: 'agent-device-plugin' },
      'agent-device-plugin',
    ],
    [{ owner: 'akitorahayashi', name: 'xlsx' }, 'xlsx'],
    [{ owner: 'akitorahayashi', name: 'xlsx' }, 'xlsx'],
  ]);
});

test('parsePluginCatalog lets a declared name override the repo name', () => {
  const catalog = parsePluginCatalog(
    VALID.replace(
      'repo: akitorahayashi/xlsx',
      'repo: akitorahayashi/xlsx\n    name: spreadsheet',
    ),
    'plugins.yml',
  );

  expect(catalog.marketplaces[1]?.repo.name).toBe('xlsx');
  expect(catalog.marketplaces[1]?.name).toBe('spreadsheet');
});

for (const repo of ['xlsx', 'akitorahayashi/xlsx/extra', 'akitorahayashi/']) {
  test(`parsePluginCatalog rejects repo ${JSON.stringify(repo)}`, () => {
    expect(() =>
      parsePluginCatalog(
        VALID.replace(
          'repo: akitorahayashi/xlsx',
          `repo: ${JSON.stringify(repo)}`,
        ),
        'plugins.yml',
      ),
    ).toThrow(/repo/);
  });
}

test('parsePluginCatalog rejects an empty clients list', () => {
  expect(() =>
    parsePluginCatalog(
      VALID.replace('clients: [claude, codex]', 'clients: []'),
      'plugins.yml',
    ),
  ).toThrow(/clients must not be empty/);
});

test('parsePluginCatalog rejects duplicate plugin identities per client', () => {
  expect(() =>
    parsePluginCatalog(
      VALID.replace(
        'plugins: [xlsx]',
        'plugins: [xlsx]\n  - clients: [codex]\n    repo: akitorahayashi/other\n    plugins: [xlsx]',
      ),
      'plugins.yml',
    ),
  ).toThrow(/duplicate 'codex:xlsx'/);
});

test('parsePluginCatalog rejects a duplicate client within one entry', () => {
  expect(() =>
    parsePluginCatalog(
      VALID.replace('clients: [claude, codex]', 'clients: [codex, codex]'),
      'plugins.yml',
    ),
  ).toThrow(/duplicate 'codex:xlsx'/);
});

test('parsePluginCatalog treats omitted removal lists as nothing to remove', () => {
  const catalog = parsePluginCatalog(
    VALID.slice(0, VALID.indexOf('removed_marketplaces')),
    'plugins.yml',
  );

  expect(catalog.marketplaces[0]?.uninstall).toEqual([]);
  expect(catalog.removedMarketplaces).toEqual([]);
});

test('parsePluginCatalog rejects a name declared in both plugins and uninstall', () => {
  expect(() =>
    parsePluginCatalog(
      VALID.replace('uninstall: [legacy-tool]', 'uninstall: [xlsx]'),
      'plugins.yml',
    ),
  ).toThrow(/duplicate 'xlsx'/);
});

test('parsePluginCatalog accepts a removal-only catalog', () => {
  const catalog = parsePluginCatalog(
    `
marketplaces: []
removed_marketplaces:
  - clients: [claude]
    repo: akitorahayashi/retired
`,
    'plugins.yml',
  );

  expect(catalog.marketplaces).toEqual([]);
  expect(catalog.removedMarketplaces.map(({ name }) => name)).toEqual([
    'retired',
  ]);
});

test('parsePluginCatalog rejects a removed marketplace still declared active', () => {
  expect(() =>
    parsePluginCatalog(
      VALID.replace(
        'clients: [claude]\n    repo: akitorahayashi/retired',
        'clients: [codex]\n    repo: akitorahayashi/xlsx',
      ),
      'plugins.yml',
    ),
  ).toThrow(/'codex:xlsx', which is still declared/);
});

test('plugin ids are marketplace-scoped', () => {
  expect(pluginId('xlsx', 'xlsx')).toBe('xlsx@xlsx');
});
