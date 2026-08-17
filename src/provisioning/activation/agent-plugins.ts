import {
  idInMarketplace,
  type PluginClient,
  type PluginMarketplace,
  parsePluginCatalog,
  pluginId,
  type RemovedMarketplace,
} from '../../agent-plugin/catalog';
import {
  DroppedPluginsError,
  type EnsureOutcome,
  type MarketplaceRemotes,
  pluginClientOps,
  type RegistrationCache,
} from '../../agent-plugin/client';
import type {
  InstalledPlugin,
  PluginInventory,
} from '../../agent-plugin/inventory';
import { errorMessage } from '../../errors';
import { remoteMatchesRepository, sshRemoteUrl } from '../../github/repository';
import { readSshHost } from '../../github/ssh-host';
import type { Context } from '../../host/context';
import { mapWithConcurrency } from '../../host/task-pool';
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

// Same budget as RELEASE_DOWNLOAD_CONCURRENCY: marketplaces are independent
// network round trips, not CPU-bound work.
const AGENT_PLUGIN_CONCURRENCY = 8;

interface ClientInventory {
  readonly installed?: PluginInventory;
  readonly error?: string;
}

interface VerificationTarget {
  readonly client: PluginClient;
  readonly id: string;
  readonly entryIndex: number;
}

/** What the run did to converge one declared plugin, in the order performed. */
type PluginAction = 'installed' | 'upgraded' | 'enabled';

/**
 * A declared plugin the run acted on, settled against the post-run inventory:
 * present and enabled to stand. `previousVersion` is recorded only when the
 * upgrade was the sole action, so it doubles as the version-diff refinement
 * gate — anything else changed the host whatever the version says.
 */
interface DeclaredTarget {
  readonly client: PluginClient;
  readonly id: string;
  readonly entryIndex: number;
  readonly previousVersion: string | undefined;
}

// entryIndex on declared/removals is local to this result's own entries, not
// the run's shared array — mergeOutcome rebases it once merged.
interface MarketplaceOutcome {
  readonly entries: StepReport[];
  readonly declared: DeclaredTarget[];
  readonly removals: VerificationTarget[];
}

function mergeOutcome(
  entries: StepReport[],
  declared: DeclaredTarget[],
  removals: VerificationTarget[],
  outcome: MarketplaceOutcome,
): void {
  const offset = entries.length;
  entries.push(...outcome.entries);
  for (const target of outcome.declared) {
    declared.push({ ...target, entryIndex: target.entryIndex + offset });
  }
  for (const target of outcome.removals) {
    removals.push({ ...target, entryIndex: target.entryIndex + offset });
  }
}

/**
 * The first action a declared plugin still needs, or null when it already sits
 * at the declared state. Desired state is installed *and* enabled — an
 * installed-but-disabled plugin contributes nothing to the client, so presence
 * alone never satisfies a declaration. In upgrade mode an installed plugin
 * always needs the upgrade first; the reconcile loop enables it afterwards when
 * it was also disabled.
 */
function pendingAction(
  current: InstalledPlugin | undefined,
  upgrade: boolean,
): 'install' | 'upgrade' | 'enable' | null {
  if (current === undefined) return 'install';
  if (upgrade) return 'upgrade';
  return current.enabled ? null : 'enable';
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
      const key = `${marketplace.client}:${id}`;
      const pending = pendingAction(installed.get(id), upgrade);
      // A plugin that still needed something never reached it, so it is a
      // failure rather than a presence; only a plugin nothing was asked of is
      // unchanged.
      return pending === null
        ? { key, value: 'already installed', status: 'unchanged' }
        : { key, value: `${pending} blocked`, status: 'failed', error: detail };
    }),
  ];
}

/**
 * The marketplace ensure outcome. `added` and `reregistered` are observable
 * config changes; `refreshed` is a probe whose observable effects surface
 * through per-plugin version diffs.
 */
interface EnsuredMarketplace {
  readonly outcome: EnsureOutcome;
  readonly droppedPlugins: boolean;
  readonly report: StepReport;
}

const ENSURE_WORDING: Readonly<Record<EnsureOutcome, string>> = {
  added: 'marketplace added from main',
  reregistered: 'marketplace re-registered from main',
  refreshed: 'marketplace refreshed from main',
};

/**
 * Converge a marketplace registration, rendering the one report shape both
 * clients produce. Which outcome happened is the capability's answer; the
 * wording is this layer's.
 */
async function ensureMarketplace(
  marketplace: PluginMarketplace,
  url: string,
  context: Context,
  registrations: MarketplaceRegistrations,
): Promise<EnsuredMarketplace> {
  const { outcome, droppedPlugins } = await pluginClientOps[
    marketplace.client
  ].ensureMarketplace(
    marketplace.name,
    marketplace.repo,
    url,
    context,
    registrations.cacheFor(marketplace.client, context),
  );
  return {
    outcome,
    droppedPlugins,
    report: {
      key: `${marketplace.client}:${marketplace.name}`,
      value: ENSURE_WORDING[outcome],
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
  private readonly pending = new Map<
    PluginClient,
    Promise<MarketplaceRemotes>
  >();

  // Single-flighted: concurrent marketplaces of the same client would
  // otherwise both fetch on a cold cache, and the second write would discard
  // any registration the first had recorded into its now-orphaned map.
  of(client: PluginClient, context: Context): Promise<MarketplaceRemotes> {
    const cached = this.byClient.get(client);
    if (cached) return Promise.resolve(cached);
    let inflight = this.pending.get(client);
    if (!inflight) {
      inflight = pluginClientOps[client]
        .listMarketplaces(context)
        .then((remotes) => {
          this.byClient.set(client, remotes);
          this.pending.delete(client);
          return remotes;
        });
      this.pending.set(client, inflight);
    }
    return inflight;
  }

  cacheFor(client: PluginClient, context: Context): RegistrationCache {
    return {
      current: () => this.of(client, context),
      record: (name, registration) => {
        this.byClient.get(client)?.set(name, registration);
      },
      forget: (name) => this.forget(client, name),
    };
  }

  forget(client: PluginClient, name: string): void {
    this.byClient.get(client)?.delete(name);
  }
}

const SURVIVED_UNINSTALL =
  'Plugin was still present in the post-uninstall inventory.';

function verificationFailure(
  client: PluginClient,
  id: string,
  error: string,
): StepReport {
  return {
    key: `${client}:${id}`,
    value: 'verification failed',
    status: 'failed',
    error,
  };
}

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
    await pluginClientOps[client].uninstallPlugin(id, context);
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
    const remaining = await pluginClientOps[client].listPlugins(context);
    for (const target of issued) {
      const survivor = remaining.get(target.id);
      if (survivor === undefined) continue;
      installed.set(target.id, survivor);
      entries[target.entryIndex] = verificationFailure(
        client,
        target.id,
        SURVIVED_UNINSTALL,
      );
      confirmed = false;
    }
  } catch (error) {
    for (const target of issued) {
      entries[target.entryIndex] = verificationFailure(
        client,
        target.id,
        errorMessage(error),
      );
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
): Promise<StepReport[]> {
  const entries: StepReport[] = [];
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
    return entries;
  }
  if (registration === 'foreign') {
    entries.push({
      key,
      value: 'marketplace removal refused',
      status: 'failed',
      error: `Marketplace '${removed.name}' is configured from a different source; expected ${removed.repo.owner}/${removed.repo.name}.`,
    });
    return entries;
  }

  // An already-deregistered marketplace can still leave installed plugins
  // behind; the tombstone names their namespace, so they are uninstalled
  // either way.
  const ids = [...installed.keys()].filter((id) =>
    idInMarketplace(id, removed.name),
  );
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
    return entries;
  }
  if (registration === 'absent') {
    entries.push({
      key,
      value: 'marketplace already absent',
      status: 'unchanged',
    });
    return entries;
  }
  try {
    await pluginClientOps[removed.client].removeMarketplace(
      removed.name,
      context,
    );
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
  return entries;
}

function invalidateNamespacePlugins(
  installed: PluginInventory,
  marketplace: string,
): void {
  for (const id of [...installed.keys()]) {
    if (idInMarketplace(id, marketplace)) installed.delete(id);
  }
}

/**
 * Whether the client's registration for this marketplace already matches the
 * declared source, read from the per-run listing. Anything else — absent,
 * drifted, or foreign — must flow into the ensure pass, which converges or
 * refuses it.
 */
async function registrationConverged(
  marketplace: PluginMarketplace,
  url: string,
  context: Context,
  registrations: MarketplaceRegistrations,
): Promise<boolean> {
  const current = (await registrations.of(marketplace.client, context)).get(
    marketplace.name,
  );
  return (
    current !== undefined &&
    pluginClientOps[marketplace.client].registrationMatches(current, url)
  );
}

async function reconcileMarketplace(
  marketplace: PluginMarketplace,
  sshHost: string,
  installed: PluginInventory,
  upgrade: boolean,
  context: Context,
  registrations: MarketplaceRegistrations,
): Promise<MarketplaceOutcome> {
  const entries: StepReport[] = [];
  const declared: DeclaredTarget[] = [];
  const removals: VerificationTarget[] = [];
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
  const url = sshRemoteUrl(sshHost, marketplace.repo);
  // The marketplace phase is what makes a missing plugin resolvable and what an
  // upgrade re-resolves against, and it is the only way a drifted registration
  // converges — so those three are what earn the network. Enabling an already
  // installed plugin is a local operation and deliberately does not: the
  // registration listing is a local read, so a converged marketplace whose only
  // gap is a disabled plugin stays off the network entirely.
  // The registration probe sits inside the same boundary as the ensure: a
  // failing or malformed marketplace listing is this marketplace's failure, not
  // the whole activation's, so its siblings and the removal pass still run.
  try {
    if (
      upgrade ||
      desired.some((id) => !installed.has(id)) ||
      !(await registrationConverged(marketplace, url, context, registrations))
    ) {
      const ensured = await ensureMarketplace(
        marketplace,
        url,
        context,
        registrations,
      );
      // A convergence that uninstalled the marketplace's plugins invalidates the
      // pre-run inventory for its id namespace: the desired plugins below then
      // reinstall and verify instead of standing on a stale 'already installed'.
      if (ensured.droppedPlugins) {
        invalidateNamespacePlugins(installed, marketplace.name);
      }
      // In upgrade mode a refresh of an existing marketplace is a probe: the
      // fetch itself would otherwise report every run as changed, so change is
      // reported solely through the per-plugin version diffs it enables.
      if (ensured.outcome !== 'refreshed' || !upgrade) {
        entries.push(ensured.report);
      }
    }
  } catch (error) {
    // A typed drop means the failure already destroyed the namespace on the
    // host, so its plugins must report as blocked rather than as installed.
    if (error instanceof DroppedPluginsError) {
      invalidateNamespacePlugins(installed, marketplace.name);
    }
    entries.push(
      ...marketplaceFailureEntries(marketplace, installed, error, upgrade),
    );
    return { entries, declared, removals };
  }

  const ops = pluginClientOps[marketplace.client];
  for (const id of desired) {
    const key = `${marketplace.client}:${id}`;
    const current = installed.get(id);
    let action = pendingAction(current, upgrade);
    if (action === null) {
      entries.push({ key, value: 'already installed', status: 'unchanged' });
      continue;
    }
    const entryIndex = entries.length;
    const actions: PluginAction[] = [];
    try {
      if (current === undefined) {
        await ops.installPlugin(id, context);
        actions.push('installed');
        // Only presence is read from the map for this id after this point; the
        // post-run inventory is what settles the outcome.
        installed.set(id, { version: undefined, enabled: true });
      } else {
        if (action === 'upgrade') {
          await ops.upgradePlugin(id, context);
          actions.push('upgraded');
        }
        // Enablement and version are independent axes, so an upgraded plugin
        // that was disabled is still enabled here — without reissuing the
        // command on a client whose upgrade verb already enables.
        if (!current.enabled) {
          action = 'enable';
          if (!(upgrade && ops.upgradeEnables)) {
            await ops.enablePlugin(id, context);
          }
          actions.push('enabled');
        }
      }
    } catch (error) {
      entries.push({
        key,
        value: `${action} failed`,
        status: 'failed',
        error: errorMessage(error),
      });
      continue;
    }
    // Provisional: the post-run inventory confirms presence and enablement, and
    // refines a pure upgrade to changed or unchanged by version diff.
    entries.push({ key, value: actions.join(' and '), status: 'changed' });
    declared.push({
      client: marketplace.client,
      id,
      entryIndex,
      previousVersion:
        actions.length === 1 && actions[0] === 'upgraded'
          ? current?.version
          : undefined,
    });
  }
  return { entries, declared, removals };
}

/**
 * One post-run inventory per client settles every outcome: a declared plugin must
 * be present and enabled to stand, an uninstall must be absent, and an entry
 * whose only action was the upgrade is refined to changed or unchanged by
 * comparing the reported version against the pre-run one.
 */
async function verifyOutcomes(
  clients: readonly PluginClient[],
  context: Context,
  entries: StepReport[],
  declared: readonly DeclaredTarget[],
  removals: readonly VerificationTarget[],
): Promise<void> {
  // Per-client verifications are independent (each writes only its own
  // targets' entry indices), so the inventory spawns run concurrently.
  await Promise.all(
    clients.map(async (client) => {
      const clientDeclared = declared.filter(
        (target) => target.client === client,
      );
      const clientRemovals = removals.filter(
        (target) => target.client === client,
      );
      if (clientDeclared.length === 0 && clientRemovals.length === 0) return;
      try {
        const installed = await pluginClientOps[client].listPlugins(context);
        for (const target of clientRemovals) {
          if (!installed.has(target.id)) continue;
          entries[target.entryIndex] = verificationFailure(
            client,
            target.id,
            SURVIVED_UNINSTALL,
          );
        }
        for (const target of clientDeclared) {
          const current = installed.get(target.id);
          if (current === undefined) {
            entries[target.entryIndex] = verificationFailure(
              client,
              target.id,
              'Plugin was not present in the post-run inventory.',
            );
            continue;
          }
          if (!current.enabled) {
            entries[target.entryIndex] = verificationFailure(
              client,
              target.id,
              'Plugin was still disabled in the post-run inventory.',
            );
            continue;
          }
          if (
            target.previousVersion === undefined ||
            current.version === undefined
          ) {
            // Without versions on both sides a no-op cannot be proven, so the
            // provisional 'upgraded' (changed) entry stands.
            continue;
          }
          const key = `${client}:${target.id}`;
          entries[target.entryIndex] =
            current.version === target.previousVersion
              ? {
                  key,
                  value: `already latest (${current.version})`,
                  status: 'unchanged',
                }
              : {
                  key,
                  value: `upgraded to ${current.version}`,
                  status: 'changed',
                };
        }
      } catch (error) {
        for (const target of [...clientDeclared, ...clientRemovals]) {
          entries[target.entryIndex] = verificationFailure(
            client,
            target.id,
            errorMessage(error),
          );
        }
      }
    }),
  );
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
    // Each inventory boots the client's full CLI, so the independent per-client
    // listings run concurrently rather than paying each boot in sequence.
    await Promise.all(
      clients.map(async (client) => {
        try {
          inventories.set(client, {
            installed: await pluginClientOps[client].listPlugins(context),
          });
        } catch (error) {
          inventories.set(client, { error: errorMessage(error) });
        }
      }),
    );

    const entries: StepReport[] = [];
    const declared: DeclaredTarget[] = [];
    const removals: VerificationTarget[] = [];
    const registrations = new MarketplaceRegistrations();
    const marketplaceOutcomes = await mapWithConcurrency(
      catalog.marketplaces,
      AGENT_PLUGIN_CONCURRENCY,
      (marketplace): Promise<MarketplaceOutcome> => {
        const inventory = inventories.get(marketplace.client);
        if (!inventory?.installed) {
          return Promise.resolve({
            entries: inventoryFailureEntries(
              marketplace,
              inventory?.error ?? 'Plugin inventory is unavailable.',
            ),
            declared: [],
            removals: [],
          });
        }
        return reconcileMarketplace(
          marketplace,
          sshHost,
          inventory.installed,
          options.upgrade,
          context,
          registrations,
        );
      },
    );
    for (const outcome of marketplaceOutcomes) {
      mergeOutcome(entries, declared, removals, outcome);
    }

    const removalOutcomes = await mapWithConcurrency(
      catalog.removedMarketplaces,
      AGENT_PLUGIN_CONCURRENCY,
      (removed): Promise<StepReport[]> => {
        const inventory = inventories.get(removed.client);
        if (!inventory?.installed) {
          return Promise.resolve([
            {
              key: `${removed.client}:${removed.name}`,
              value: 'inventory failed',
              status: 'failed',
              error: inventory?.error ?? 'Plugin inventory is unavailable.',
            },
          ]);
        }
        return removeDeclaredMarketplace(
          removed,
          inventory.installed,
          context,
          registrations,
        );
      },
    );
    for (const removedEntries of removalOutcomes) {
      entries.push(...removedEntries);
    }

    await verifyOutcomes(clients, context, entries, declared, removals);
    return {
      ...base,
      status: aggregateStatus(entries),
      entries,
    };
  });
}
