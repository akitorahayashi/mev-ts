import {
  marketplaceSshUrl,
  type PluginCatalog,
  type PluginClient,
  type PluginMarketplace,
  parsePluginCatalog,
  pluginId,
  type RemovedMarketplace,
} from '../../agent-plugin/catalog';
import {
  addClaudeMarketplace,
  installClaudePlugin,
  listClaudeMarketplaces,
  listClaudePlugins,
  removeClaudeMarketplace,
  uninstallClaudePlugin,
  updateClaudeMarketplace,
  updateClaudePlugin,
} from '../../agent-plugin/claude';
import {
  ensureCodexMarketplace,
  installCodexPlugin,
  listCodexMarketplaces,
  listCodexPlugins,
  removeCodexMarketplace,
  removeCodexPlugin,
  upgradeCodexMarketplace,
} from '../../agent-plugin/codex';
import { readPluginSshHost } from '../../agent-plugin/source';
import { errorMessage, ProvisioningError } from '../../errors';
import type { Context } from '../../host/context';
import type {
  Activation,
  ActivationReport,
  ActivationRunOptions,
  Described,
  StepReport,
} from './contract';
import { readDeployedManifest } from './manifest';
import { manifestSource } from './manifest-kind';
import { aggregateStatus, guarded } from './reconcile';

type AgentPluginsActivation = Extract<Activation, { kind: 'agentPlugins' }>;

/** Installed plugin ids with the version the client reported, if any. */
type PluginInventory = Map<string, string | undefined>;

interface ClientInventory {
  readonly installed?: PluginInventory;
  readonly error?: string;
}

interface VerificationTarget {
  readonly client: PluginClient;
  readonly id: string;
  readonly entryIndex: number;
}

interface UpdateTarget {
  readonly client: PluginClient;
  readonly id: string;
  readonly entryIndex: number;
  readonly previousVersion: string | undefined;
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
): Promise<PluginInventory> {
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

async function updatePlugin(
  client: PluginClient,
  id: string,
  context: Context,
): Promise<void> {
  switch (client) {
    case 'claude':
      return updateClaudePlugin(id, context);
    case 'codex':
      // codex has no plugin-level update verb. Re-adding an installed plugin is
      // idempotent and re-resolves its version from the marketplace snapshot
      // that ensureMarketplace just refreshed (verified against the codex CLI:
      // `plugin add` on an installed plugin succeeds and reports the resolved
      // version).
      return installCodexPlugin(id, context);
  }
}

async function uninstallPlugin(
  client: PluginClient,
  id: string,
  context: Context,
): Promise<void> {
  switch (client) {
    case 'claude':
      return uninstallClaudePlugin(id, context);
    case 'codex':
      return removeCodexPlugin(id, context);
  }
}

async function removeMarketplace(
  client: PluginClient,
  name: string,
  context: Context,
): Promise<void> {
  switch (client) {
    case 'claude':
      return removeClaudeMarketplace(name, context);
    case 'codex':
      return removeCodexMarketplace(name, context);
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
  installed: PluginInventory,
  error: unknown,
  update: boolean,
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
      if (!installed.has(id)) {
        return {
          key: `${marketplace.client}:${id}`,
          value: 'install blocked',
          status: 'failed',
          error: detail,
        };
      }
      // In update mode an unreachable marketplace blocks the requested update,
      // so the installed plugin is a failure rather than an unchanged presence.
      return update
        ? {
            key: `${marketplace.client}:${id}`,
            value: 'update blocked',
            status: 'failed',
            error: detail,
          }
        : {
            key: `${marketplace.client}:${id}`,
            value: 'already installed',
            status: 'unchanged',
          };
    }),
  ];
}

/**
 * The marketplace ensure outcome. `added` distinguishes registering a new
 * marketplace (an observable config change) from refreshing an existing one —
 * a probe whose observable effects surface through per-plugin version diffs.
 */
interface EnsuredMarketplace {
  readonly added: boolean;
  readonly report: StepReport;
}

async function ensureClaudeMarketplace(
  marketplace: PluginMarketplace,
  url: string,
  context: Context,
  cache: { inventory?: Awaited<ReturnType<typeof listClaudeMarketplaces>> },
): Promise<EnsuredMarketplace> {
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
      added: true,
      report: {
        key: `claude:${marketplace.name}`,
        value: 'marketplace added from main',
        status: 'changed',
      },
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
    added: false,
    report: {
      key: `claude:${marketplace.name}`,
      value: 'marketplace refreshed from main',
      status: 'changed',
    },
  };
}

async function ensureMarketplace(
  marketplace: PluginMarketplace,
  url: string,
  context: Context,
  claudeCache: {
    inventory?: Awaited<ReturnType<typeof listClaudeMarketplaces>>;
  },
): Promise<EnsuredMarketplace> {
  switch (marketplace.client) {
    case 'claude':
      return ensureClaudeMarketplace(marketplace, url, context, claudeCache);
    case 'codex': {
      const alreadyAdded = await ensureCodexMarketplace(url, context);
      if (alreadyAdded) {
        await upgradeCodexMarketplace(marketplace.name, context);
      }
      return {
        added: !alreadyAdded,
        report: {
          key: `codex:${marketplace.name}`,
          value: alreadyAdded
            ? 'marketplace refreshed from main'
            : 'marketplace added from main',
          status: 'changed',
        },
      };
    }
  }
}

/**
 * Uninstall one installed plugin, mutating the in-memory inventory so later
 * phases see post-removal state. Returns false when the uninstall failed.
 */
async function uninstallInstalled(
  client: PluginClient,
  id: string,
  installed: PluginInventory,
  context: Context,
  entries: StepReport[],
  removals: VerificationTarget[],
): Promise<boolean> {
  const entryIndex = entries.length;
  try {
    await uninstallPlugin(client, id, context);
    installed.delete(id);
    entries.push({
      key: `${client}:${id}`,
      value: 'uninstalled',
      status: 'changed',
    });
    removals.push({ client, id, entryIndex });
    return true;
  } catch (error) {
    entries.push({
      key: `${client}:${id}`,
      value: 'uninstall failed',
      status: 'failed',
      error: errorMessage(error),
    });
    return false;
  }
}

async function marketplaceRegistered(
  removed: RemovedMarketplace,
  context: Context,
  claudeCache: {
    inventory?: Awaited<ReturnType<typeof listClaudeMarketplaces>>;
  },
  codexCache: { names?: Set<string> },
): Promise<boolean> {
  switch (removed.client) {
    case 'claude':
      claudeCache.inventory ??= await listClaudeMarketplaces(context);
      return claudeCache.inventory.has(removed.name);
    case 'codex':
      codexCache.names ??= await listCodexMarketplaces(context);
      return codexCache.names.has(removed.name);
  }
}

/**
 * Converge one `removed_marketplaces` entry: uninstall every installed plugin
 * in the marketplace's id namespace, then deregister the marketplace. The
 * order is fixed here because neither client documents whether marketplace
 * removal cascades, and a leftover uninstall blocks the deregistration so a
 * plugin is never orphaned from its removed marketplace.
 */
async function removeDeclaredMarketplace(
  removed: RemovedMarketplace,
  installed: PluginInventory,
  context: Context,
  claudeCache: {
    inventory?: Awaited<ReturnType<typeof listClaudeMarketplaces>>;
  },
  codexCache: { names?: Set<string> },
  entries: StepReport[],
  removals: VerificationTarget[],
): Promise<void> {
  const suffix = `@${removed.name}`;
  const ids = [...installed.keys()].filter((id) => id.endsWith(suffix));
  let blocked = false;
  for (const id of ids) {
    const uninstalled = await uninstallInstalled(
      removed.client,
      id,
      installed,
      context,
      entries,
      removals,
    );
    if (!uninstalled) blocked = true;
  }
  const key = `${removed.client}:${removed.name}`;
  if (blocked) {
    entries.push({
      key,
      value: 'marketplace removal blocked',
      status: 'failed',
      error: 'A plugin from this marketplace could not be uninstalled.',
    });
    return;
  }
  try {
    const registered = await marketplaceRegistered(
      removed,
      context,
      claudeCache,
      codexCache,
    );
    if (!registered) {
      entries.push({
        key,
        value: 'marketplace already absent',
        status: 'unchanged',
      });
      return;
    }
    await removeMarketplace(removed.client, removed.name, context);
    if (removed.client === 'claude') {
      claudeCache.inventory?.delete(removed.name);
    } else {
      codexCache.names?.delete(removed.name);
    }
    entries.push({ key, value: 'marketplace removed', status: 'changed' });
  } catch (error) {
    entries.push({
      key,
      value: 'marketplace remove failed',
      status: 'failed',
      error: errorMessage(error),
    });
  }
}

async function reconcileMarketplace(
  marketplace: PluginMarketplace,
  catalog: PluginCatalog,
  sshHost: string,
  installed: PluginInventory,
  update: boolean,
  context: Context,
  claudeCache: {
    inventory?: Awaited<ReturnType<typeof listClaudeMarketplaces>>;
  },
  entries: StepReport[],
  verification: VerificationTarget[],
  updates: UpdateTarget[],
  removals: VerificationTarget[],
): Promise<void> {
  // Uninstalls are local-only, so they run before — and independently of — the
  // network-bound marketplace phase below.
  for (const plugin of marketplace.uninstall) {
    const id = pluginId(plugin, marketplace.name);
    if (!installed.has(id)) {
      entries.push({
        key: `${marketplace.client}:${id}`,
        value: 'already absent',
        status: 'unchanged',
      });
      continue;
    }
    await uninstallInstalled(
      marketplace.client,
      id,
      installed,
      context,
      entries,
      removals,
    );
  }

  const desired = marketplace.plugins.map((plugin) =>
    pluginId(plugin, marketplace.name),
  );
  const missing = desired.filter((id) => !installed.has(id));
  if (!update && missing.length === 0) {
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
    const ensured = await ensureMarketplace(
      marketplace,
      url,
      context,
      claudeCache,
    );
    // In update mode a refresh of an existing marketplace is a probe: the
    // fetch itself would otherwise report every run as changed, so change is
    // reported solely through the per-plugin version diffs it enables.
    if (ensured.added || !update) {
      entries.push(ensured.report);
    }
  } catch (error) {
    entries.push(
      ...marketplaceFailureEntries(marketplace, installed, error, update),
    );
    return;
  }

  for (const id of desired) {
    if (installed.has(id)) {
      if (!update) {
        entries.push({
          key: `${marketplace.client}:${id}`,
          value: 'already installed',
          status: 'unchanged',
        });
        continue;
      }
      const entryIndex = entries.length;
      try {
        await updatePlugin(marketplace.client, id, context);
        // Provisional: the post-run inventory refines this entry to changed or
        // unchanged by version diff.
        entries.push({
          key: `${marketplace.client}:${id}`,
          value: 'updated',
          status: 'changed',
        });
        updates.push({
          client: marketplace.client,
          id,
          entryIndex,
          previousVersion: installed.get(id),
        });
      } catch (error) {
        entries.push({
          key: `${marketplace.client}:${id}`,
          value: 'update failed',
          status: 'failed',
          error: errorMessage(error),
        });
      }
      continue;
    }
    const entryIndex = entries.length;
    try {
      await installPlugin(marketplace.client, id, context);
      installed.set(id, undefined);
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

/**
 * One post-run inventory per client settles every outcome kind: an install
 * must be present to stand, an uninstall must be absent, and an update entry
 * is refined to changed or unchanged by comparing the reported version
 * against the pre-run one.
 */
async function verifyOutcomes(
  clients: readonly PluginClient[],
  context: Context,
  entries: StepReport[],
  installs: readonly VerificationTarget[],
  updates: readonly UpdateTarget[],
  removals: readonly VerificationTarget[],
): Promise<void> {
  for (const client of clients) {
    const clientInstalls = installs.filter(
      (target) => target.client === client,
    );
    const clientUpdates = updates.filter((target) => target.client === client);
    const clientRemovals = removals.filter(
      (target) => target.client === client,
    );
    if (
      clientInstalls.length === 0 &&
      clientUpdates.length === 0 &&
      clientRemovals.length === 0
    ) {
      continue;
    }
    try {
      const installed = await listInstalled(client, context);
      for (const target of clientInstalls) {
        if (installed.has(target.id)) continue;
        entries[target.entryIndex] = {
          key: `${client}:${target.id}`,
          value: 'verification failed',
          status: 'failed',
          error: 'Plugin was not present in the post-install inventory.',
        };
      }
      for (const target of clientRemovals) {
        if (!installed.has(target.id)) continue;
        entries[target.entryIndex] = {
          key: `${client}:${target.id}`,
          value: 'verification failed',
          status: 'failed',
          error: 'Plugin was still present in the post-uninstall inventory.',
        };
      }
      for (const target of clientUpdates) {
        if (!installed.has(target.id)) {
          entries[target.entryIndex] = {
            key: `${client}:${target.id}`,
            value: 'verification failed',
            status: 'failed',
            error: 'Plugin was not present in the post-update inventory.',
          };
          continue;
        }
        const version = installed.get(target.id);
        if (target.previousVersion === undefined || version === undefined) {
          // Without versions on both sides a no-op cannot be proven, so the
          // provisional 'updated' (changed) entry stands.
          continue;
        }
        entries[target.entryIndex] =
          version === target.previousVersion
            ? {
                key: `${client}:${target.id}`,
                value: `already latest (${version})`,
                status: 'unchanged',
              }
            : {
                key: `${client}:${target.id}`,
                value: `updated to ${version}`,
                status: 'changed',
              };
      }
    } catch (error) {
      for (const target of [
        ...clientInstalls,
        ...clientUpdates,
        ...clientRemovals,
      ]) {
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
  options: ActivationRunOptions = { update: false },
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
      ...new Set([
        ...catalog.marketplaces.map(({ client }) => client),
        ...catalog.removedMarketplaces.map(({ client }) => client),
      ]),
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
    const updates: UpdateTarget[] = [];
    const removals: VerificationTarget[] = [];
    const claudeCache: {
      inventory?: Awaited<ReturnType<typeof listClaudeMarketplaces>>;
    } = {};
    const codexCache: { names?: Set<string> } = {};
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
        options.update,
        context,
        claudeCache,
        entries,
        verification,
        updates,
        removals,
      );
    }
    for (const removed of catalog.removedMarketplaces) {
      const inventory = inventories.get(removed.client);
      if (!inventory?.installed) {
        entries.push({
          key: `${removed.client}:${removed.name}`,
          value: 'inventory failed',
          status: 'failed',
          error: inventory?.error ?? 'Plugin inventory is unavailable.',
        });
        continue;
      }
      await removeDeclaredMarketplace(
        removed,
        inventory.installed,
        context,
        claudeCache,
        codexCache,
        entries,
        removals,
      );
    }

    await verifyOutcomes(
      clients,
      context,
      entries,
      verification,
      updates,
      removals,
    );
    return {
      ...base,
      status: aggregateStatus(entries),
      entries,
    };
  });
}
