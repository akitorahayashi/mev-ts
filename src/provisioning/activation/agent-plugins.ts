import {
  type PluginClient,
  type PluginMarketplace,
  parsePluginCatalog,
  pluginId,
  type RemovedMarketplace,
} from '../../agent-plugin/catalog';
import {
  type MarketplaceRemotes,
  type PluginInventory,
  pluginClientOps,
  type RegistrationCache,
} from '../../agent-plugin/client';
import { errorMessage } from '../../errors';
import { remoteMatchesRepository, sshRemoteUrl } from '../../github/repository';
import { readSshHost } from '../../github/ssh-host';
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

interface ClientInventory {
  readonly installed?: PluginInventory;
  readonly error?: string;
}

interface VerificationTarget {
  readonly client: PluginClient;
  readonly id: string;
  readonly entryIndex: number;
}

interface UpgradeTarget {
  readonly client: PluginClient;
  readonly id: string;
  readonly entryIndex: number;
  readonly previousVersion: string | undefined;
}

export function installAgentPlugins(configKey: string): Activation {
  return { kind: 'agentPlugins', configKey };
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

function listInstalled(
  client: PluginClient,
  context: Context,
): Promise<PluginInventory> {
  return pluginClientOps[client].listPlugins(context);
}

function installPlugin(
  client: PluginClient,
  id: string,
  context: Context,
): Promise<void> {
  return pluginClientOps[client].installPlugin(id, context);
}

function upgradePlugin(
  client: PluginClient,
  id: string,
  context: Context,
): Promise<void> {
  return pluginClientOps[client].upgradePlugin(id, context);
}

function uninstallPlugin(
  client: PluginClient,
  id: string,
  context: Context,
): Promise<void> {
  return pluginClientOps[client].uninstallPlugin(id, context);
}

function removeMarketplace(
  client: PluginClient,
  name: string,
  context: Context,
): Promise<void> {
  return pluginClientOps[client].removeMarketplace(name, context);
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
  upgrade: boolean,
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
      // In upgrade mode an unreachable marketplace blocks the requested
      // upgrade, so the installed plugin is a failure rather than an
      // unchanged presence.
      return upgrade
        ? {
            key: `${marketplace.client}:${id}`,
            value: 'upgrade blocked',
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

/**
 * Register or refresh a marketplace, rendering the one report shape both clients
 * produce. Which of the two happened is the capability's answer; the wording is
 * this layer's.
 */
async function ensureMarketplace(
  marketplace: PluginMarketplace,
  url: string,
  context: Context,
  registrations: MarketplaceRegistrations,
): Promise<EnsuredMarketplace> {
  const { added } = await pluginClientOps[marketplace.client].ensureMarketplace(
    marketplace.name,
    marketplace.repo,
    url,
    context,
    registrations.cacheFor(marketplace.client, context),
  );
  return {
    added,
    report: {
      key: `${marketplace.client}:${marketplace.name}`,
      value: added
        ? 'marketplace added from main'
        : 'marketplace refreshed from main',
      status: 'changed',
    },
  };
}

/**
 * The registered marketplaces of each client, listed at most once per run and
 * kept current as registrations are added and removed, so the ensure pass and
 * the later ownership probe share one view of the host.
 */
class MarketplaceRegistrations {
  private readonly byClient = new Map<PluginClient, MarketplaceRemotes>();

  async of(
    client: PluginClient,
    context: Context,
  ): Promise<MarketplaceRemotes> {
    let remotes = this.byClient.get(client);
    if (!remotes) {
      remotes = await pluginClientOps[client].listMarketplaces(context);
      this.byClient.set(client, remotes);
    }
    return remotes;
  }

  cacheFor(client: PluginClient, context: Context): RegistrationCache {
    return {
      current: () => this.of(client, context),
      record: (name, registration) => {
        this.byClient.get(client)?.set(name, registration);
      },
    };
  }

  forget(client: PluginClient, name: string): void {
    this.byClient.get(client)?.delete(name);
  }
}

const SURVIVED_UNINSTALL =
  'Plugin was still present in the post-uninstall inventory.';

/**
 * Uninstall one installed plugin, mutating the in-memory inventory so later
 * phases see post-removal state. Returns the index of the pushed entry, or
 * null when the uninstall command failed; the caller decides where the
 * absence is verified.
 */
async function uninstallInstalled(
  client: PluginClient,
  id: string,
  installed: PluginInventory,
  context: Context,
  entries: StepReport[],
): Promise<number | null> {
  const entryIndex = entries.length;
  try {
    await uninstallPlugin(client, id, context);
    installed.delete(id);
    entries.push({
      key: `${client}:${id}`,
      value: 'uninstalled',
      status: 'changed',
    });
    return entryIndex;
  } catch (error) {
    entries.push({
      key: `${client}:${id}`,
      value: 'uninstall failed',
      status: 'failed',
      error: errorMessage(error),
    });
    return null;
  }
}

type MarketplaceRegistration = 'absent' | 'owned' | 'foreign';

/**
 * Whether the marketplace a tombstone names is registered, and if so whether
 * its registered source is the repository the tombstone declares. A same-named
 * marketplace registered from any other repository is foreign.
 */
async function probeRemovedRegistration(
  removed: RemovedMarketplace,
  context: Context,
  registrations: MarketplaceRegistrations,
): Promise<MarketplaceRegistration> {
  const remotes = await registrations.of(removed.client, context);
  const current = remotes.get(removed.name);
  if (!current) return 'absent';
  return remoteMatchesRepository(current.url, removed.repo)
    ? 'owned'
    : 'foreign';
}

/**
 * Confirm the plugins just uninstalled are absent, rewriting the entry of any
 * that survived. A zero exit status is not proof of removal, and this verdict
 * gates deregistration, so it cannot wait for the shared post-run pass.
 */
async function confirmUninstalled(
  client: PluginClient,
  issued: readonly VerificationTarget[],
  installed: PluginInventory,
  context: Context,
  entries: StepReport[],
): Promise<boolean> {
  if (issued.length === 0) return true;
  let confirmed = true;
  try {
    const remaining = await listInstalled(client, context);
    for (const target of issued) {
      if (!remaining.has(target.id)) continue;
      installed.set(target.id, remaining.get(target.id));
      entries[target.entryIndex] = {
        key: `${client}:${target.id}`,
        value: 'verification failed',
        status: 'failed',
        error: SURVIVED_UNINSTALL,
      };
      confirmed = false;
    }
  } catch (error) {
    for (const target of issued) {
      entries[target.entryIndex] = {
        key: `${client}:${target.id}`,
        value: 'verification failed',
        status: 'failed',
        error: errorMessage(error),
      };
    }
    confirmed = false;
  }
  return confirmed;
}

/**
 * Converge one `removed_marketplaces` entry: verify the registered source
 * matches the tombstone's repository, uninstall every installed plugin in the
 * marketplace's id namespace, confirm they are gone, then deregister the
 * marketplace. The source check runs first because a same-named marketplace
 * registered from another source is not mev's to dismantle — nothing in its
 * namespace is touched. The plugin-before-marketplace order is fixed because
 * neither client documents whether marketplace removal cascades; deregistering
 * while a plugin survives would orphan it, so an unconfirmed removal blocks.
 */
async function removeDeclaredMarketplace(
  removed: RemovedMarketplace,
  installed: PluginInventory,
  context: Context,
  registrations: MarketplaceRegistrations,
  entries: StepReport[],
): Promise<void> {
  const key = `${removed.client}:${removed.name}`;
  let registration: MarketplaceRegistration;
  try {
    registration = await probeRemovedRegistration(
      removed,
      context,
      registrations,
    );
  } catch (error) {
    entries.push({
      key,
      value: 'marketplace remove failed',
      status: 'failed',
      error: errorMessage(error),
    });
    return;
  }
  if (registration === 'foreign') {
    entries.push({
      key,
      value: 'marketplace removal refused',
      status: 'failed',
      error: `Marketplace '${removed.name}' is configured from a different source; expected ${removed.repo.owner}/${removed.repo.name}.`,
    });
    return;
  }

  // An already-deregistered marketplace can still leave installed plugins
  // behind; the tombstone names their namespace, so they are uninstalled
  // either way.
  const suffix = `@${removed.name}`;
  const ids = [...installed.keys()].filter((id) => id.endsWith(suffix));
  const issued: VerificationTarget[] = [];
  let blocked = false;
  for (const id of ids) {
    const entryIndex = await uninstallInstalled(
      removed.client,
      id,
      installed,
      context,
      entries,
    );
    if (entryIndex === null) blocked = true;
    else issued.push({ client: removed.client, id, entryIndex });
  }
  if (
    !(await confirmUninstalled(
      removed.client,
      issued,
      installed,
      context,
      entries,
    ))
  ) {
    blocked = true;
  }
  if (blocked) {
    entries.push({
      key,
      value: 'marketplace removal blocked',
      status: 'failed',
      error: 'A plugin from this marketplace could not be uninstalled.',
    });
    return;
  }
  if (registration === 'absent') {
    entries.push({
      key,
      value: 'marketplace already absent',
      status: 'unchanged',
    });
    return;
  }
  try {
    await removeMarketplace(removed.client, removed.name, context);
    registrations.forget(removed.client, removed.name);
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
  sshHost: string,
  installed: PluginInventory,
  upgrade: boolean,
  context: Context,
  registrations: MarketplaceRegistrations,
  entries: StepReport[],
  verification: VerificationTarget[],
  upgrades: UpgradeTarget[],
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
    const entryIndex = await uninstallInstalled(
      marketplace.client,
      id,
      installed,
      context,
      entries,
    );
    if (entryIndex !== null) {
      removals.push({ client: marketplace.client, id, entryIndex });
    }
  }

  const desired = marketplace.plugins.map((plugin) =>
    pluginId(plugin, marketplace.name),
  );
  const missing = desired.filter((id) => !installed.has(id));
  if (!upgrade && missing.length === 0) {
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

  const url = sshRemoteUrl(sshHost, marketplace.repo);
  try {
    const ensured = await ensureMarketplace(
      marketplace,
      url,
      context,
      registrations,
    );
    // In upgrade mode a refresh of an existing marketplace is a probe: the
    // fetch itself would otherwise report every run as changed, so change is
    // reported solely through the per-plugin version diffs it enables.
    if (ensured.added || !upgrade) {
      entries.push(ensured.report);
    }
  } catch (error) {
    entries.push(
      ...marketplaceFailureEntries(marketplace, installed, error, upgrade),
    );
    return;
  }

  for (const id of desired) {
    if (installed.has(id)) {
      if (!upgrade) {
        entries.push({
          key: `${marketplace.client}:${id}`,
          value: 'already installed',
          status: 'unchanged',
        });
        continue;
      }
      const entryIndex = entries.length;
      try {
        await upgradePlugin(marketplace.client, id, context);
        // Provisional: the post-run inventory refines this entry to changed or
        // unchanged by version diff.
        entries.push({
          key: `${marketplace.client}:${id}`,
          value: 'upgraded',
          status: 'changed',
        });
        upgrades.push({
          client: marketplace.client,
          id,
          entryIndex,
          previousVersion: installed.get(id),
        });
      } catch (error) {
        entries.push({
          key: `${marketplace.client}:${id}`,
          value: 'upgrade failed',
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
 * must be present to stand, an uninstall must be absent, and an upgrade entry
 * is refined to changed or unchanged by comparing the reported version
 * against the pre-run one.
 */
async function verifyOutcomes(
  clients: readonly PluginClient[],
  context: Context,
  entries: StepReport[],
  installs: readonly VerificationTarget[],
  upgrades: readonly UpgradeTarget[],
  removals: readonly VerificationTarget[],
): Promise<void> {
  for (const client of clients) {
    const clientInstalls = installs.filter(
      (target) => target.client === client,
    );
    const clientUpgrades = upgrades.filter(
      (target) => target.client === client,
    );
    const clientRemovals = removals.filter(
      (target) => target.client === client,
    );
    if (
      clientInstalls.length === 0 &&
      clientUpgrades.length === 0 &&
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
          error: SURVIVED_UNINSTALL,
        };
      }
      for (const target of clientUpgrades) {
        if (!installed.has(target.id)) {
          entries[target.entryIndex] = {
            key: `${client}:${target.id}`,
            value: 'verification failed',
            status: 'failed',
            error: 'Plugin was not present in the post-upgrade inventory.',
          };
          continue;
        }
        const version = installed.get(target.id);
        if (target.previousVersion === undefined || version === undefined) {
          // Without versions on both sides a no-op cannot be proven, so the
          // provisional 'upgraded' (changed) entry stands.
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
                value: `upgraded to ${version}`,
                status: 'changed',
              };
      }
    } catch (error) {
      for (const target of [
        ...clientInstalls,
        ...clientUpgrades,
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
  options: ActivationRunOptions = { upgrade: false },
): Promise<ActivationReport> {
  const base = describeAgentPlugins(activation);
  return guarded(base, async () => {
    const catalog = await readDeployedManifest(
      activation.configKey,
      context.home,
      parsePluginCatalog,
      'Agent plugin catalog',
    );
    const sshHost = await readSshHost(context.home);
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
    const upgrades: UpgradeTarget[] = [];
    const removals: VerificationTarget[] = [];
    const registrations = new MarketplaceRegistrations();
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
        sshHost,
        inventory.installed,
        options.upgrade,
        context,
        registrations,
        entries,
        verification,
        upgrades,
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
        registrations,
        entries,
      );
    }

    await verifyOutcomes(
      clients,
      context,
      entries,
      verification,
      upgrades,
      removals,
    );
    return {
      ...base,
      status: aggregateStatus(entries),
      entries,
    };
  });
}
