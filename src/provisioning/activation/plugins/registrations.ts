import type {
  PluginClient,
  PluginMarketplace,
  RemovedMarketplace,
} from '../../../agent-plugin/catalog';
import type {
  EnsureOutcome,
  MarketplaceRemotes,
  PluginClients,
  RegistrationCache,
} from '../../../agent-plugin/client';
import { remoteMatchesRepository } from '../../../github/repository';
import type { Context } from '../../../host/context';
import type { ReconcileItemResult } from '../contract';

/**
 * The marketplace ensure outcome. `added` and `reregistered` are observable
 * config changes; `refreshed` is a probe whose observable effects surface
 * through per-plugin version diffs.
 */
interface EnsuredMarketplace {
  readonly outcome: EnsureOutcome;
  readonly droppedPlugins: boolean;
  readonly report: ReconcileItemResult;
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
export async function ensureMarketplace(
  marketplace: PluginMarketplace,
  url: string,
  context: Context,
  registrations: MarketplaceRegistrations,
  clientOps: PluginClients,
): Promise<EnsuredMarketplace> {
  const { outcome, droppedPlugins } = await clientOps[
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
export class MarketplaceRegistrations {
  constructor(private readonly clientOps: PluginClients) {}

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
      inflight = this.clientOps[client]
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

/**
 * Whether the client's registration for this marketplace already matches the
 * declared source, read from the per-run listing. Anything else — absent,
 * drifted, or foreign — must flow into the ensure pass, which converges or
 * refuses it.
 */
export async function registrationConverged(
  marketplace: PluginMarketplace,
  url: string,
  context: Context,
  registrations: MarketplaceRegistrations,
  clientOps: PluginClients,
): Promise<boolean> {
  const current = (await registrations.of(marketplace.client, context)).get(
    marketplace.name,
  );
  return (
    current !== undefined &&
    clientOps[marketplace.client].registrationMatches(current, url)
  );
}

export type MarketplaceRegistration = 'absent' | 'owned' | 'foreign';

/**
 * Whether the marketplace a tombstone names is registered, and if so whether
 * its registered source is the repository the tombstone declares. A same-named
 * marketplace registered from any other repository is foreign.
 */
export async function probeRemovedRegistration(
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
