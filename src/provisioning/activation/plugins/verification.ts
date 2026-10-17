import type { PluginClient } from '../../../agent-plugin/catalog';
import type { PluginClients } from '../../../agent-plugin/client';
import type { PluginInventory } from '../../../agent-plugin/inventory';
import { errorMessage } from '../../../errors';
import type { Context } from '../../../host/context';
import { drainAll } from '../../../host/task-pool';
import { propagateActivityObserverError } from '../activity';
import type { ReconcileItemResult } from '../contract';

export interface VerificationTarget {
  readonly client: PluginClient;
  readonly id: string;
}

/**
 * A declared plugin the run acted on, settled against the post-run inventory:
 * present and enabled to stand. `previousVersion` is recorded only when the
 * upgrade was the sole action, so it doubles as the version-diff refinement
 * gate — anything else changed the host whatever the version says.
 */
export interface DeclaredTarget extends VerificationTarget {
  readonly previousVersion: string | undefined;
}

const SURVIVED_UNINSTALL =
  'Plugin was still present in the post-uninstall inventory.';

function replaceResult(
  entries: ReconcileItemResult[],
  result: ReconcileItemResult,
): void {
  const index = entries.findIndex((entry) => entry.key === result.key);
  if (index < 0)
    throw new Error(`Missing provisional plugin result '${result.key}'.`);
  entries[index] = result;
}

function verificationFailure(
  client: PluginClient,
  id: string,
  error: string,
): ReconcileItemResult {
  return {
    key: `${client}:${id}`,
    value: 'verification failed',
    status: 'failed',
    error,
  };
}

/**
 * Confirm the plugins just uninstalled are absent, rewriting the entry of any
 * that survived. A zero exit status is not proof of removal, and this verdict
 * gates deregistration, so it cannot wait for the shared post-run pass.
 */
export async function confirmUninstalled(
  client: PluginClient,
  issued: readonly VerificationTarget[],
  installed: PluginInventory,
  context: Context,
  entries: ReconcileItemResult[],
  clientOps: PluginClients,
): Promise<boolean> {
  if (issued.length === 0) return true;
  let confirmed = true;
  try {
    const remaining = await clientOps[client].listPlugins(context, 'verify');
    for (const target of issued) {
      const survivor = remaining.get(target.id);
      if (survivor === undefined) continue;
      installed.set(target.id, survivor);
      replaceResult(
        entries,
        verificationFailure(client, target.id, SURVIVED_UNINSTALL),
      );
      confirmed = false;
    }
  } catch (error) {
    propagateActivityObserverError(error);
    for (const target of issued) {
      replaceResult(
        entries,
        verificationFailure(client, target.id, errorMessage(error)),
      );
    }
    confirmed = false;
  }
  return confirmed;
}

/**
 * One post-run inventory per client settles every outcome: a declared plugin must
 * be present and enabled to stand, an uninstall must be absent, and an entry
 * whose only action was the upgrade is refined to changed or unchanged by
 * comparing the reported version against the pre-run one.
 */
export async function verifyOutcomes(
  clients: readonly PluginClient[],
  context: Context,
  entries: ReconcileItemResult[],
  declared: readonly DeclaredTarget[],
  removals: readonly VerificationTarget[],
  clientOps: PluginClients,
): Promise<void> {
  await drainAll(
    clients.map(async (client) => {
      const clientDeclared = declared.filter(
        (target) => target.client === client,
      );
      const clientRemovals = removals.filter(
        (target) => target.client === client,
      );
      if (clientDeclared.length === 0 && clientRemovals.length === 0) return;
      try {
        const installed = await clientOps[client].listPlugins(
          context,
          'verify',
        );
        for (const target of clientRemovals) {
          if (!installed.has(target.id)) continue;
          replaceResult(
            entries,
            verificationFailure(client, target.id, SURVIVED_UNINSTALL),
          );
        }
        for (const target of clientDeclared) {
          const current = installed.get(target.id);
          if (current === undefined) {
            replaceResult(
              entries,
              verificationFailure(
                client,
                target.id,
                'Plugin was not present in the post-run inventory.',
              ),
            );
            continue;
          }
          if (!current.enabled) {
            replaceResult(
              entries,
              verificationFailure(
                client,
                target.id,
                'Plugin was still disabled in the post-run inventory.',
              ),
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
          replaceResult(
            entries,
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
                },
          );
        }
      } catch (error) {
        propagateActivityObserverError(error);
        for (const target of [...clientDeclared, ...clientRemovals]) {
          replaceResult(
            entries,
            verificationFailure(client, target.id, errorMessage(error)),
          );
        }
      }
    }),
  );
}
