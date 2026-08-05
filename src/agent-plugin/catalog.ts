import { ProvisioningError } from '../errors';
import {
  requireExactKeys,
  requireRecord,
  requireStringArray,
  requireUniqueBy,
} from '../host/parse';
import { loadYaml } from '../host/yaml';

export const pluginClients = ['claude', 'codex'] as const;
export type PluginClient = (typeof pluginClients)[number];

export interface PluginMarketplace {
  readonly client: PluginClient;
  readonly repository: string;
  readonly name: string;
  readonly plugins: readonly string[];
}

export interface PluginCatalog {
  readonly source: {
    readonly owner: string;
    readonly defaultSshHost: string;
  };
  readonly marketplaces: readonly PluginMarketplace[];
}

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function requireSafeName(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SAFE_NAME.test(value)) {
    throw new ProvisioningError(
      `${label} must contain only letters, digits, '.', '_', and '-', and must start with a letter or digit.`,
    );
  }
  return value;
}

export function requireSshHost(value: unknown, label = 'SSH host'): string {
  return requireSafeName(value, label);
}

function requireClient(value: unknown, label: string): PluginClient {
  if (
    typeof value !== 'string' ||
    !pluginClients.includes(value as PluginClient)
  ) {
    throw new ProvisioningError(
      `${label} must be one of: ${pluginClients.join(', ')}.`,
    );
  }
  return value as PluginClient;
}

function parseMarketplace(value: unknown, index: number): PluginMarketplace {
  const label = `Agent plugin catalog marketplace ${index + 1}`;
  const record = requireRecord(value, label);
  requireExactKeys(record, ['client', 'repository', 'name', 'plugins'], label);
  const plugins = requireStringArray(record['plugins'], `${label} plugins`);
  if (plugins.length === 0) {
    throw new ProvisioningError(`${label} plugins must not be empty.`);
  }
  const parsed = {
    client: requireClient(record['client'], `${label} client`),
    repository: requireSafeName(record['repository'], `${label} repository`),
    name: requireSafeName(record['name'], `${label} name`),
    plugins: plugins.map((plugin, pluginIndex) =>
      requireSafeName(plugin, `${label} plugin ${pluginIndex + 1}`),
    ),
  };
  requireUniqueBy(parsed.plugins, (plugin) => plugin, `${label} plugins`);
  return parsed;
}

export function parsePluginCatalog(raw: string, path: string): PluginCatalog {
  const label = `Agent plugin catalog ${path}`;
  const root = requireRecord(loadYaml(raw, path), label);
  requireExactKeys(root, ['source', 'marketplaces'], label);

  const source = requireRecord(root['source'], `${label} source`);
  requireExactKeys(source, ['owner', 'default_ssh_host'], `${label} source`);

  const marketplaceValues = root['marketplaces'];
  if (!Array.isArray(marketplaceValues)) {
    throw new ProvisioningError(`${label} marketplaces must be a sequence.`);
  }
  if (marketplaceValues.length === 0) {
    throw new ProvisioningError(`${label} marketplaces must not be empty.`);
  }
  const marketplaces = marketplaceValues.map(parseMarketplace);
  requireUniqueBy(
    marketplaces,
    ({ client, name }) => `${client}:${name}`,
    `${label} marketplaces`,
  );
  requireUniqueBy(
    marketplaces.flatMap(({ client, name, plugins }) =>
      plugins.map((plugin) => ({ client, name, plugin })),
    ),
    ({ client, plugin }) => `${client}:${plugin}`,
    `${label} plugins`,
  );

  return {
    source: {
      owner: requireSafeName(source['owner'], `${label} source owner`),
      defaultSshHost: requireSshHost(
        source['default_ssh_host'],
        `${label} source default_ssh_host`,
      ),
    },
    marketplaces,
  };
}

export function pluginId(plugin: string, marketplace: string): string {
  return `${plugin}@${marketplace}`;
}

export function marketplaceSshUrl(
  sshHost: string,
  owner: string,
  repository: string,
): string {
  return `git@${sshHost}:${owner}/${repository}.git`;
}
