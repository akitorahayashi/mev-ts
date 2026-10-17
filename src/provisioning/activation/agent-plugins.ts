import {
  type PluginClient,
  parsePluginCatalog,
} from '../../agent-plugin/catalog';
import { createPluginClients } from '../../agent-plugin/client';
import type { PluginInventory } from '../../agent-plugin/inventory';
import { errorMessage } from '../../errors';
import { readSshHost } from '../../github/ssh-host';
import type { Context } from '../../host/context';
import { resolveHostPath } from '../../host/path';
import { drainAll } from '../../host/task-pool';
import { propagateActivityObserverError, reportActivity } from './activity';
import type {
  Activation,
  ActivationDescription,
  ActivationReport,
  ActivationRunOptions,
  ReconcileItemResult,
} from './contract';
import { readDeployedManifest } from './manifest';
import {
  inventoryFailureEntries,
  type MarketplaceOutcome,
  reconcileMarketplace,
} from './plugins/reconciliation';
import { MarketplaceRegistrations } from './plugins/registrations';
import { removeDeclaredMarketplace } from './plugins/removal';
import {
  type DeclaredTarget,
  type VerificationTarget,
  verifyOutcomes,
} from './plugins/verification';
import { activationReport, guarded, stepOutcome } from './reconcile';

type AgentPluginsActivation = Extract<Activation, { kind: 'agentPlugins' }>;

interface ClientInventory {
  readonly installed?: PluginInventory;
  readonly error?: string;
}

export function installAgentPlugins(
  configKey: string,
  pathPrefix: AgentPluginsActivation['pathPrefix'],
): Activation {
  return { kind: 'agentPlugins', configKey, pathPrefix };
}

export function describeAgentPlugins(
  _activation: AgentPluginsActivation,
): ActivationDescription {
  return {
    subject: 'agent plugins',
    unchangedCollection: 'agent plugins',
  };
}

function withClientPath(
  activation: AgentPluginsActivation,
  context: Context,
): Context {
  const path = [
    ...activation.pathPrefix.map((entry) =>
      resolveHostPath(entry, context.home),
    ),
    context.basePath,
  ]
    .filter(Boolean)
    .join(':');
  return {
    ...context,
    commands: {
      run(command, args, options) {
        return context.commands.run(command, args, {
          ...options,
          env: { ...options?.env, PATH: path },
        });
      },
    },
  };
}

export function runAgentPlugins(
  activation: AgentPluginsActivation,
  context: Context,
  options: ActivationRunOptions = { upgrade: false },
): Promise<ActivationReport> {
  const base = describeAgentPlugins(activation);
  return guarded(base, async () => {
    const clientContext = withClientPath(activation, context);
    const clientOps = createPluginClients((activity) => {
      reportActivity(options.onActivity, {
        subject: activity.subject,
        action: activity.action,
        operation: {
          id: activity.id,
          group: activity.client,
          state: activity.state,
        },
      });
    });
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
    await drainAll(
      clients.map(async (client) => {
        try {
          inventories.set(client, {
            installed: await clientOps[client].listPlugins(clientContext),
          });
        } catch (error) {
          propagateActivityObserverError(error);
          inventories.set(client, { error: errorMessage(error) });
        }
      }),
    );

    const entries: ReconcileItemResult[] = [];
    const declared: DeclaredTarget[] = [];
    const removals: VerificationTarget[] = [];
    const registrations = new MarketplaceRegistrations(clientOps);
    const marketplaceOutcomes = await drainAll(
      catalog.marketplaces.map((marketplace): Promise<MarketplaceOutcome> => {
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
          clientContext,
          registrations,
          clientOps,
        );
      }),
    );
    for (const outcome of marketplaceOutcomes) {
      entries.push(...outcome.entries);
      declared.push(...outcome.declared);
      removals.push(...outcome.removals);
    }

    const removalOutcomes = await drainAll(
      catalog.removedMarketplaces.map(
        (removed): Promise<ReconcileItemResult[]> => {
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
            clientContext,
            registrations,
            clientOps,
          );
        },
      ),
    );
    for (const removedEntries of removalOutcomes) {
      entries.push(...removedEntries);
    }

    await verifyOutcomes(
      clients,
      clientContext,
      entries,
      declared,
      removals,
      clientOps,
    );
    return activationReport(base, entries.map(stepOutcome));
  });
}
