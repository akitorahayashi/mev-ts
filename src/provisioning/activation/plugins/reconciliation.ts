import {
  idInMarketplace,
  type PluginMarketplace,
  pluginId,
} from '../../../agent-plugin/catalog';
import {
  DroppedPluginsError,
  type PluginClients,
} from '../../../agent-plugin/client';
import { MarketplaceFetchError } from '../../../agent-plugin/command';
import type {
  InstalledPlugin,
  PluginInventory,
} from '../../../agent-plugin/inventory';
import { errorMessage } from '../../../errors';
import { sshRemoteUrl } from '../../../github/repository';
import type { Context } from '../../../host/context';
import { propagateActivityObserverError } from '../activity';
import type { ReconcileItemResult } from '../contract';
import {
  ensureMarketplace,
  type MarketplaceRegistrations,
  registrationConverged,
} from './registrations';
import { uninstallInstalled } from './removal';
import type { DeclaredTarget, VerificationTarget } from './verification';

/** What the run did to converge one declared plugin, in the order performed. */
type PluginAction = 'installed' | 'upgraded' | 'enabled';

export interface MarketplaceOutcome {
  readonly entries: ReconcileItemResult[];
  readonly declared: DeclaredTarget[];
  readonly removals: VerificationTarget[];
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

export function inventoryFailureEntries(
  marketplace: PluginMarketplace,
  error: string,
): ReconcileItemResult[] {
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
): [ReconcileItemResult, ...ReconcileItemResult[]] {
  const detail = errorMessage(error);
  return [
    {
      key: `${marketplace.client}:${marketplace.name}`,
      value: 'marketplace unavailable',
      status: 'failed',
      error: detail,
    },
    ...marketplace.plugins.map((plugin): ReconcileItemResult => {
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

function invalidateNamespacePlugins(
  installed: PluginInventory,
  marketplace: string,
): void {
  for (const id of [...installed.keys()]) {
    if (idInMarketplace(id, marketplace)) installed.delete(id);
  }
}

export async function reconcileMarketplace(
  marketplace: PluginMarketplace,
  sshHost: string,
  installed: PluginInventory,
  upgrade: boolean,
  context: Context,
  registrations: MarketplaceRegistrations,
  clientOps: PluginClients,
): Promise<MarketplaceOutcome> {
  const entries: ReconcileItemResult[] = [];
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
    const uninstalled = await uninstallInstalled(
      marketplace.client,
      id,
      installed,
      context,
      entries,
      clientOps,
    );
    if (uninstalled) {
      removals.push({ client: marketplace.client, id });
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
  let marketplaceError: string | undefined;
  try {
    if (
      upgrade ||
      desired.some((id) => !installed.has(id)) ||
      !(await registrationConverged(
        marketplace,
        url,
        context,
        registrations,
        clientOps,
      ))
    ) {
      const ensured = await ensureMarketplace(
        marketplace,
        url,
        context,
        registrations,
        clientOps,
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
    propagateActivityObserverError(error);
    // A typed drop means the failure already destroyed the namespace on the
    // host, so its plugins must report as blocked rather than as installed.
    if (error instanceof DroppedPluginsError) {
      invalidateNamespacePlugins(installed, marketplace.name);
    }
    const [failure, ...blocked] = marketplaceFailureEntries(
      marketplace,
      installed,
      error,
      upgrade,
    );
    entries.push(failure);
    if (!(error instanceof MarketplaceFetchError)) {
      entries.push(...blocked);
      return { entries, declared, removals };
    }
    marketplaceError = errorMessage(error);
  }

  const ops = clientOps[marketplace.client];
  for (const id of desired) {
    const key = `${marketplace.client}:${id}`;
    const current = installed.get(id);
    let action = pendingAction(current, upgrade);
    if (action === null) {
      entries.push({ key, value: 'already installed', status: 'unchanged' });
      continue;
    }
    const upgradeBlocked = marketplaceError !== undefined && upgrade;
    if (
      marketplaceError !== undefined &&
      (current === undefined || (upgrade && current.enabled))
    ) {
      entries.push({
        key,
        value: `${action} blocked`,
        status: 'failed',
        error: marketplaceError,
      });
      continue;
    }
    const actions: PluginAction[] = [];
    try {
      if (current === undefined) {
        await ops.installPlugin(id, context);
        actions.push('installed');
        // Only presence is read from the map for this id after this point; the
        // post-run inventory is what settles the outcome.
        installed.set(id, { version: undefined, enabled: true });
      } else {
        if (action === 'upgrade' && !upgradeBlocked) {
          await ops.upgradePlugin(id, context);
          actions.push('upgraded');
        }
        // Enablement and version are independent axes, so an upgraded plugin
        // that was disabled is still enabled here — without reissuing the
        // command on a client whose upgrade verb already enables.
        if (!current.enabled) {
          action = 'enable';
          if (!(actions.includes('upgraded') && ops.upgradeEnables)) {
            await ops.enablePlugin(id, context);
          }
          actions.push('enabled');
        }
      }
    } catch (error) {
      propagateActivityObserverError(error);
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
    entries.push({
      key,
      value: `${actions.join(' and ')}${upgradeBlocked ? '; upgrade blocked' : ''}`,
      status: upgradeBlocked ? 'failed' : 'changed',
      ...(upgradeBlocked ? { error: marketplaceError } : {}),
    });
    declared.push({
      client: marketplace.client,
      id,
      previousVersion:
        actions.length === 1 && actions[0] === 'upgraded'
          ? current?.version
          : undefined,
    });
  }
  return { entries, declared, removals };
}
