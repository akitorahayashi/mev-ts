import { ProvisioningError } from '../errors';
import { parseRepository, type Repository } from '../github/repository';
import {
  requireExactKeys,
  requireRecord,
  requireStringArray,
  requireUniqueBy,
} from '../host/parse';
import { loadYaml } from '../host/yaml';

/**
 * The branch every first-party marketplace is tracked from. Missing plugins
 * install from it, but installed ones are upgraded only by an explicit
 * `--upgrade` run — see docs/architecture/agent-plugins.md. One owner, because
 * the two clients spell the same ref differently (a URL fragment versus a flag)
 * and a probe compares against it.
 */
export const MARKETPLACE_REF = 'main';

const pluginClients = ['claude', 'codex'] as const;
export type PluginClient = (typeof pluginClients)[number];

export interface PluginMarketplace {
  readonly client: PluginClient;
  readonly repo: Repository;
  readonly name: string;
  readonly plugins: readonly string[];
  readonly uninstall: readonly string[];
}

/** A marketplace whose registration and installed plugins are to be removed. */
export interface RemovedMarketplace {
  readonly client: PluginClient;
  readonly repo: Repository;
  readonly name: string;
}

export interface PluginCatalog {
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

function requireClients(value: unknown, label: string): PluginClient[] {
  const clients = requireStringArray(value, label);
  if (clients.length === 0) {
    throw new ProvisioningError(`${label} must not be empty.`);
  }
  return clients.map((client, index) => {
    if (!pluginClients.includes(client as PluginClient)) {
      throw new ProvisioningError(
        `${label} ${index + 1} must be one of: ${pluginClients.join(', ')}.`,
      );
    }
    return client as PluginClient;
  });
}

/**
 * The registered marketplace name is self-declared by the repository's
 * marketplace.json — a separate namespace from the repo name that matches it
 * in practice, so `name` is declared only when the two diverge.
 */
function marketplaceName(
  record: Record<string, unknown>,
  repo: Repository,
  label: string,
): string {
  return record['name'] === undefined
    ? repo.name
    : requireSafeName(record['name'], `${label} name`);
}

/**
 * One catalog entry declares the same marketplace for every client it lists,
 * so an entry expands into one marketplace per client. Divergent per-client
 * plugin sets from the same repo remain expressible as separate entries.
 */
function parseMarketplace(value: unknown, index: number): PluginMarketplace[] {
  const label = `Agent plugin catalog marketplace ${index + 1}`;
  const record = requireRecord(value, label);
  requireExactKeys(
    record,
    ['clients', 'repo', 'name', 'plugins', 'uninstall'],
    label,
  );
  const clients = requireClients(record['clients'], `${label} clients`);
  const repo = parseRepository(record['repo'], `${label} repo`);
  const rawPlugins = requireStringArray(record['plugins'], `${label} plugins`);
  if (rawPlugins.length === 0) {
    throw new ProvisioningError(`${label} plugins must not be empty.`);
  }
  // Absent means nothing to remove; only names written here are ever
  // uninstalled.
  const rawUninstall =
    record['uninstall'] === undefined
      ? []
      : requireStringArray(record['uninstall'], `${label} uninstall`);
  const name = marketplaceName(record, repo, label);
  const plugins = rawPlugins.map((plugin, pluginIndex) =>
    requireSafeName(plugin, `${label} plugin ${pluginIndex + 1}`),
  );
  const uninstall = rawUninstall.map((plugin, pluginIndex) =>
    requireSafeName(plugin, `${label} uninstall ${pluginIndex + 1}`),
  );
  requireUniqueBy(
    [...plugins, ...uninstall],
    (plugin) => plugin,
    `${label} plugins`,
  );
  return clients.map((client) => ({ client, repo, name, plugins, uninstall }));
}

function parseRemovedMarketplace(
  value: unknown,
  index: number,
): RemovedMarketplace[] {
  const label = `Agent plugin catalog removed marketplace ${index + 1}`;
  const record = requireRecord(value, label);
  requireExactKeys(record, ['clients', 'repo', 'name'], label);
  const clients = requireClients(record['clients'], `${label} clients`);
  const repo = parseRepository(record['repo'], `${label} repo`);
  const name = marketplaceName(record, repo, label);
  return clients.map((client) => ({ client, repo, name }));
}

export function parsePluginCatalog(raw: string, path: string): PluginCatalog {
  const label = `Agent plugin catalog ${path}`;
  const root = requireRecord(loadYaml(raw, path), label);
  requireExactKeys(root, ['marketplaces', 'removed_marketplaces'], label);

  const marketplaceValues = root['marketplaces'];
  if (!Array.isArray(marketplaceValues)) {
    throw new ProvisioningError(`${label} marketplaces must be a sequence.`);
  }
  // An empty sequence is a valid end state: it is what declaring the removal
  // of the last active marketplace leaves behind.
  const marketplaces = marketplaceValues.flatMap(parseMarketplace);
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

  const removedValues = root['removed_marketplaces'] ?? [];
  if (!Array.isArray(removedValues)) {
    throw new ProvisioningError(
      `${label} removed_marketplaces must be a sequence.`,
    );
  }
  const removedMarketplaces = removedValues.flatMap(parseRemovedMarketplace);
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

  return { marketplaces, removedMarketplaces };
}

export function pluginId(plugin: string, marketplace: string): string {
  return `${plugin}@${marketplace}`;
}

export function idInMarketplace(id: string, marketplace: string): boolean {
  return id.endsWith(`@${marketplace}`);
}
