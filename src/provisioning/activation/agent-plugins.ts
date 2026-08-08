import {
  marketplaceSshUrl,
  type PluginCatalog,
  type PluginClient,
  type PluginMarketplace,
  parsePluginCatalog,
  pluginId,
} from '../../agent-plugin/catalog';
import {
  addClaudeMarketplace,
  installClaudePlugin,
  listClaudeMarketplaces,
  listClaudePlugins,
  updateClaudeMarketplace,
} from '../../agent-plugin/claude';
import {
  ensureCodexMarketplace,
  installCodexPlugin,
  listCodexPlugins,
  upgradeCodexMarketplace,
} from '../../agent-plugin/codex';
import { readPluginSshHost } from '../../agent-plugin/source';
import { errorMessage, ProvisioningError } from '../../errors';
import type { Context } from '../../host/context';
import type {
  Activation,
  ActivationReport,
  Described,
  StepReport,
} from './contract';
import { readDeployedManifest } from './manifest';
import { manifestSource } from './manifest-kind';
import { aggregateStatus, guarded } from './reconcile';

type AgentPluginsActivation = Extract<Activation, { kind: 'agentPlugins' }>;

interface ClientInventory {
  readonly installed?: Set<string>;
  readonly error?: string;
}

interface VerificationTarget {
  readonly client: PluginClient;
  readonly id: string;
  readonly entryIndex: number;
}

export function installAgentPlugins(configKey: string): Activation {
  return { kind: 'agentPlugins', configKey };
}

export function agentPluginsConfigAssets(
  activation: AgentPluginsActivation,
): readonly string[] {
  return [activation.configKey];
}

export function describeAgentPlugins(
  activation: AgentPluginsActivation,
): Described {
  return {
    verb: 'apply',
    source: manifestSource(activation.configKey),
    dest: 'agent plugins',
  };
}

async function listInstalled(
  client: PluginClient,
  context: Context,
): Promise<Set<string>> {
  switch (client) {
    case 'claude':
      return listClaudePlugins(context);
    case 'codex':
      return listCodexPlugins(context);
  }
}

async function installPlugin(
  client: PluginClient,
  id: string,
  context: Context,
): Promise<void> {
  switch (client) {
    case 'claude':
      return installClaudePlugin(id, context);
    case 'codex':
      return installCodexPlugin(id, context);
  }
}

function inventoryFailureEntries(
  marketplace: PluginMarketplace,
  error: string,
): StepReport[] {
  return marketplace.plugins.map((plugin) => ({
    key: `${marketplace.client}:${pluginId(plugin, marketplace.name)}`,
    value: 'inventory failed',
    status: 'failed',
    error,
  }));
}

function marketplaceFailureEntries(
  marketplace: PluginMarketplace,
  installed: ReadonlySet<string>,
  error: unknown,
): StepReport[] {
  const detail = errorMessage(error);
  return [
    {
      key: `${marketplace.client}:${marketplace.name}`,
      value: 'marketplace unavailable',
      status: 'failed',
      error: detail,
    },
    ...marketplace.plugins.map((plugin): StepReport => {
      const id = pluginId(plugin, marketplace.name);
      return installed.has(id)
        ? {
            key: `${marketplace.client}:${id}`,
            value: 'already installed',
            status: 'unchanged',
          }
        : {
            key: `${marketplace.client}:${id}`,
            value: 'install blocked',
            status: 'failed',
            error: detail,
          };
    }),
  ];
}

async function ensureClaudeMarketplace(
  marketplace: PluginMarketplace,
  url: string,
  context: Context,
  cache: { inventory?: Awaited<ReturnType<typeof listClaudeMarketplaces>> },
): Promise<StepReport> {
  cache.inventory ??= await listClaudeMarketplaces(context);
  const current = cache.inventory.get(marketplace.name);
  if (!current) {
    await addClaudeMarketplace(url, context);
    cache.inventory.set(marketplace.name, {
      source: 'git',
      url,
      ref: 'main',
    });
    return {
      key: `claude:${marketplace.name}`,
      value: 'marketplace added from main',
      status: 'changed',
    };
  }
  if (
    current.source !== 'git' ||
    current.url !== url ||
    current.ref !== 'main'
  ) {
    throw new ProvisioningError(
      `Claude marketplace '${marketplace.name}' is configured from a different source; expected ${url}#main.`,
    );
  }
  await updateClaudeMarketplace(marketplace.name, context);
  return {
    key: `claude:${marketplace.name}`,
    value: 'marketplace refreshed from main',
    status: 'changed',
  };
}

async function ensureMarketplace(
  marketplace: PluginMarketplace,
  url: string,
  context: Context,
  claudeCache: {
    inventory?: Awaited<ReturnType<typeof listClaudeMarketplaces>>;
  },
): Promise<StepReport> {
  switch (marketplace.client) {
    case 'claude':
      return ensureClaudeMarketplace(marketplace, url, context, claudeCache);
    case 'codex': {
      const alreadyAdded = await ensureCodexMarketplace(url, context);
      if (alreadyAdded) {
        await upgradeCodexMarketplace(marketplace.name, context);
      }
      return {
        key: `codex:${marketplace.name}`,
        value: alreadyAdded
          ? 'marketplace refreshed from main'
          : 'marketplace added from main',
        status: 'changed',
      };
    }
  }
}

async function reconcileMarketplace(
  marketplace: PluginMarketplace,
  catalog: PluginCatalog,
  sshHost: string,
  installed: Set<string>,
  context: Context,
  claudeCache: {
    inventory?: Awaited<ReturnType<typeof listClaudeMarketplaces>>;
  },
  entries: StepReport[],
  verification: VerificationTarget[],
): Promise<void> {
  const desired = marketplace.plugins.map((plugin) =>
    pluginId(plugin, marketplace.name),
  );
  const missing = desired.filter((id) => !installed.has(id));
  if (missing.length === 0) {
    entries.push(
      ...desired.map(
        (id): StepReport => ({
          key: `${marketplace.client}:${id}`,
          value: 'already installed',
          status: 'unchanged',
        }),
      ),
    );
    return;
  }

  const url = marketplaceSshUrl(
    sshHost,
    catalog.source.owner,
    marketplace.repository,
  );
  try {
    entries.push(
      await ensureMarketplace(marketplace, url, context, claudeCache),
    );
  } catch (error) {
    entries.push(...marketplaceFailureEntries(marketplace, installed, error));
    return;
  }

  for (const id of desired) {
    if (installed.has(id)) {
      entries.push({
        key: `${marketplace.client}:${id}`,
        value: 'already installed',
        status: 'unchanged',
      });
      continue;
    }
    const entryIndex = entries.length;
    try {
      await installPlugin(marketplace.client, id, context);
      installed.add(id);
      entries.push({
        key: `${marketplace.client}:${id}`,
        value: 'installed',
        status: 'changed',
      });
      verification.push({ client: marketplace.client, id, entryIndex });
    } catch (error) {
      entries.push({
        key: `${marketplace.client}:${id}`,
        value: 'install failed',
        status: 'failed',
        error: errorMessage(error),
      });
    }
  }
}

async function verifyInstalls(
  clients: readonly PluginClient[],
  context: Context,
  entries: StepReport[],
  targets: readonly VerificationTarget[],
): Promise<void> {
  for (const client of clients) {
    const clientTargets = targets.filter((target) => target.client === client);
    if (clientTargets.length === 0) continue;
    try {
      const installed = await listInstalled(client, context);
      for (const target of clientTargets) {
        if (installed.has(target.id)) continue;
        entries[target.entryIndex] = {
          key: `${client}:${target.id}`,
          value: 'verification failed',
          status: 'failed',
          error: 'Plugin was not present in the post-install inventory.',
        };
      }
    } catch (error) {
      for (const target of clientTargets) {
        entries[target.entryIndex] = {
          key: `${client}:${target.id}`,
          value: 'verification failed',
          status: 'failed',
          error: errorMessage(error),
        };
      }
    }
  }
}

export function runAgentPlugins(
  activation: AgentPluginsActivation,
  context: Context,
): Promise<ActivationReport> {
  const base = describeAgentPlugins(activation);
  return guarded(base, async () => {
    const catalog = await readDeployedManifest(
      activation.configKey,
      context.home,
      parsePluginCatalog,
      'Agent plugin catalog',
    );
    const sshHost = await readPluginSshHost(
      context.home,
      catalog.source.defaultSshHost,
    );
    const clients = [
      ...new Set(catalog.marketplaces.map(({ client }) => client)),
    ];
    const inventories = new Map<PluginClient, ClientInventory>();
    for (const client of clients) {
      try {
        inventories.set(client, {
          installed: await listInstalled(client, context),
        });
      } catch (error) {
        inventories.set(client, { error: errorMessage(error) });
      }
    }

    const entries: StepReport[] = [];
    const verification: VerificationTarget[] = [];
    const claudeCache: {
      inventory?: Awaited<ReturnType<typeof listClaudeMarketplaces>>;
    } = {};
    for (const marketplace of catalog.marketplaces) {
      const inventory = inventories.get(marketplace.client);
      if (!inventory?.installed) {
        entries.push(
          ...inventoryFailureEntries(
            marketplace,
            inventory?.error ?? 'Plugin inventory is unavailable.',
          ),
        );
        continue;
      }
      await reconcileMarketplace(
        marketplace,
        catalog,
        sshHost,
        inventory.installed,
        context,
        claudeCache,
        entries,
        verification,
      );
    }

    await verifyInstalls(clients, context, entries, verification);
    return {
      ...base,
      status: aggregateStatus(entries),
      entries,
    };
  });
}
