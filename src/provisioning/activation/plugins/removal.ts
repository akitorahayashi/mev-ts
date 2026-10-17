import {
  idInMarketplace,
  type PluginClient,
  type RemovedMarketplace,
} from '../../../agent-plugin/catalog';
import type { PluginClients } from '../../../agent-plugin/client';
import type { PluginInventory } from '../../../agent-plugin/inventory';
import { errorMessage } from '../../../errors';
import type { Context } from '../../../host/context';
import { propagateActivityObserverError } from '../activity';
import type { ReconcileItemResult } from '../contract';
import {
  type MarketplaceRegistration,
  type MarketplaceRegistrations,
  probeRemovedRegistration,
} from './registrations';
import { confirmUninstalled, type VerificationTarget } from './verification';

/**
 * Uninstall one installed plugin, mutating the in-memory inventory so later
 * phases see post-removal state. The caller decides where the
 * absence is verified.
 */
export async function uninstallInstalled(
  client: PluginClient,
  id: string,
  installed: PluginInventory,
  context: Context,
  entries: ReconcileItemResult[],
  clientOps: PluginClients,
): Promise<boolean> {
  try {
    await clientOps[client].uninstallPlugin(id, context);
    installed.delete(id);
    entries.push({
      key: `${client}:${id}`,
      value: 'uninstalled',
      status: 'changed',
    });
    return true;
  } catch (error) {
    propagateActivityObserverError(error);
    entries.push({
      key: `${client}:${id}`,
      value: 'uninstall failed',
      status: 'failed',
      error: errorMessage(error),
    });
    return false;
  }
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
export async function removeDeclaredMarketplace(
  removed: RemovedMarketplace,
  installed: PluginInventory,
  context: Context,
  registrations: MarketplaceRegistrations,
  clientOps: PluginClients,
): Promise<ReconcileItemResult[]> {
  const entries: ReconcileItemResult[] = [];
  const key = `${removed.client}:${removed.name}`;
  let registration: MarketplaceRegistration;
  try {
    registration = await probeRemovedRegistration(
      removed,
      context,
      registrations,
    );
  } catch (error) {
    propagateActivityObserverError(error);
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
    const uninstalled = await uninstallInstalled(
      removed.client,
      id,
      installed,
      context,
      entries,
      clientOps,
    );
    if (!uninstalled) blocked = true;
    else issued.push({ client: removed.client, id });
  }
  if (
    !(await confirmUninstalled(
      removed.client,
      issued,
      installed,
      context,
      entries,
      clientOps,
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
    await clientOps[removed.client].removeMarketplace(removed.name, context);
    registrations.forget(removed.client, removed.name);
    entries.push({ key, value: 'marketplace removed', status: 'changed' });
  } catch (error) {
    propagateActivityObserverError(error);
    entries.push({
      key,
      value: 'marketplace remove failed',
      status: 'failed',
      error: errorMessage(error),
    });
  }
  return entries;
}
