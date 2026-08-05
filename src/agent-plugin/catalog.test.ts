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
  - client: codex
    repository: xlsx
    name: xlsx
    plugins: [xlsx]
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
});

test('parsePluginCatalog rejects duplicate plugin identities per client', () => {
  expect(() =>
    parsePluginCatalog(
      VALID.replace(
        'plugins: [xlsx]',
        'plugins: [xlsx]\n  - client: codex\n    repository: other\n    name: other\n    plugins: [xlsx]',
      ),
      'plugins.yml',
    ),
  ).toThrow(/duplicate 'codex:xlsx'/);
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
