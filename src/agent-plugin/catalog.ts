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
  readonly uninstall: readonly string[];
}

/** A marketplace whose registration and installed plugins are to be removed. */
export interface RemovedMarketplace {
  readonly client: PluginClient;
  readonly name: string;
}

export interface PluginCatalog {
  readonly source: {
    readonly owner: string;
    readonly defaultSshHost: string;
  };
  readonly marketplaces: readonly PluginMarketplace[];
  readonly removedMarketplaces: readonly RemovedMarketplace[];
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
  requireExactKeys(
    record,
    ['client', 'repository', 'name', 'plugins', 'uninstall'],
    label,
  );
  const plugins = requireStringArray(record['plugins'], `${label} plugins`);
  if (plugins.length === 0) {
    throw new ProvisioningError(`${label} plugins must not be empty.`);
  }
  // `uninstall` is required even when empty so every entry documents the
  // removal vocabulary in place; only names written here are ever uninstalled.
  const uninstall = requireStringArray(
    record['uninstall'],
    `${label} uninstall`,
  );
  const parsed = {
    client: requireClient(record['client'], `${label} client`),
    repository: requireSafeName(record['repository'], `${label} repository`),
    name: requireSafeName(record['name'], `${label} name`),
    plugins: plugins.map((plugin, pluginIndex) =>
      requireSafeName(plugin, `${label} plugin ${pluginIndex + 1}`),
    ),
    uninstall: uninstall.map((plugin, pluginIndex) =>
      requireSafeName(plugin, `${label} uninstall ${pluginIndex + 1}`),
    ),
  };
  requireUniqueBy(
    [...parsed.plugins, ...parsed.uninstall],
    (plugin) => plugin,
    `${label} plugins`,
  );
  return parsed;
}

function parseRemovedMarketplace(
  value: unknown,
  index: number,
): RemovedMarketplace {
  const label = `Agent plugin catalog removed marketplace ${index + 1}`;
  const record = requireRecord(value, label);
  requireExactKeys(record, ['client', 'name'], label);
  return {
    client: requireClient(record['client'], `${label} client`),
    name: requireSafeName(record['name'], `${label} name`),
  };
}

export function parsePluginCatalog(raw: string, path: string): PluginCatalog {
  const label = `Agent plugin catalog ${path}`;
  const root = requireRecord(loadYaml(raw, path), label);
  requireExactKeys(
    root,
    ['source', 'marketplaces', 'removed_marketplaces'],
    label,
  );

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

  const removedValues = root['removed_marketplaces'];
  if (!Array.isArray(removedValues)) {
    throw new ProvisioningError(
      `${label} removed_marketplaces must be a sequence.`,
    );
  }
  const removedMarketplaces = removedValues.map(parseRemovedMarketplace);
  requireUniqueBy(
    removedMarketplaces,
    ({ client, name }) => `${client}:${name}`,
    `${label} removed_marketplaces`,
  );
  const active = new Set(
    marketplaces.map(({ client, name }) => `${client}:${name}`),
  );
  for (const removed of removedMarketplaces) {
    if (active.has(`${removed.client}:${removed.name}`)) {
      throw new ProvisioningError(
        `${label} removed_marketplaces contains '${removed.client}:${removed.name}', which is still declared under marketplaces.`,
      );
    }
  }

  return {
    source: {
      owner: requireSafeName(source['owner'], `${label} source owner`),
      defaultSshHost: requireSshHost(
        source['default_ssh_host'],
        `${label} source default_ssh_host`,
      ),
    },
    marketplaces,
    removedMarketplaces,
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
