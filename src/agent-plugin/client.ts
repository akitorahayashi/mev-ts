import { ProvisioningError } from '../errors';
import type { Repository } from '../github/repository';
import { remoteMatchesRepository } from '../github/repository';
import type { Context } from '../host/context';
import { MARKETPLACE_REF, type PluginClient } from './catalog';
import {
  addClaudeMarketplace,
  installClaudePlugin,
  listClaudeMarketplaces,
  listClaudePlugins,
  removeClaudeMarketplace,
  uninstallClaudePlugin,
  updateClaudeMarketplace,
  updateClaudePlugin,
} from './claude';
import {
  ensureCodexMarketplace,
  installCodexPlugin,
  listCodexMarketplaces,
  listCodexPlugins,
  removeCodexMarketplace,
  removeCodexPlugin,
  upgradeCodexMarketplace,
} from './codex';

/** Installed plugin ids mapped to the version each client reports, if any. */
export type PluginInventory = Map<string, string | undefined>;

/** One registered marketplace as the host reports it. */
export interface MarketplaceRegistration {
  /** The git remote, absent when the registration is not a git source. */
  readonly url: string | undefined;
  /** The tracked ref, absent for clients that do not report one. */
  readonly ref: string | undefined;
}

export type MarketplaceRemotes = Map<string, MarketplaceRegistration>;

/**
 * One client's registered marketplaces, listed at most once per run. Handed to
 * `ensureMarketplace` rather than pre-fetched by the caller, because only a
 * client that must inspect existing registrations should pay for listing them.
 */
export interface RegistrationCache {
  current(): Promise<MarketplaceRemotes>;
  record(name: string, registration: MarketplaceRegistration): void;
}

/**
 * The plugin operations every supported client provides, keyed by client. The
 * two CLIs spell the same operations differently — codex has no plugin-level
 * update verb, and only claude reports a ref alongside a marketplace source —
 * and those differences are absorbed here, in the capability layer that owns
 * each tool's protocol. The activation performs lookups, so adding a third
 * client is one entry rather than an edit to every dispatch site.
 */
export interface PluginClientOps {
  listPlugins(context: Context): Promise<PluginInventory>;
  installPlugin(id: string, context: Context): Promise<void>;
  upgradePlugin(id: string, context: Context): Promise<void>;
  uninstallPlugin(id: string, context: Context): Promise<void>;
  listMarketplaces(context: Context): Promise<MarketplaceRemotes>;
  removeMarketplace(name: string, context: Context): Promise<void>;
  /**
   * Register the marketplace if absent, otherwise refresh it, reporting which
   * happened, and record any new registration in `cache` so a later ownership
   * probe sees it.
   */
  ensureMarketplace(
    name: string,
    repo: Repository,
    url: string,
    context: Context,
    cache: RegistrationCache,
  ): Promise<{ readonly added: boolean }>;
}

const claudeOps: PluginClientOps = {
  listPlugins: (context) => listClaudePlugins(context),
  installPlugin: (id, context) => installClaudePlugin(id, context),
  upgradePlugin: (id, context) => updateClaudePlugin(id, context),
  uninstallPlugin: (id, context) => uninstallClaudePlugin(id, context),
  async listMarketplaces(context) {
    const inventory = await listClaudeMarketplaces(context);
    return new Map(
      [...inventory].map(([name, entry]) => [
        name,
        { url: entry.source === 'git' ? entry.url : undefined, ref: entry.ref },
      ]),
    );
  },
  removeMarketplace: (name, context) => removeClaudeMarketplace(name, context),
  async ensureMarketplace(name, repo, url, context, cache) {
    const current = (await cache.current()).get(name);
    if (!current) {
      await addClaudeMarketplace(url, context);
      cache.record(name, { url, ref: MARKETPLACE_REF });
      return { added: true };
    }
    // Claude records the ref alongside the source, so a marketplace pointing at
    // another repository or another branch is a configuration conflict rather
    // than something to silently overwrite.
    if (
      !remoteMatchesRepository(current.url, repo) ||
      current.ref !== MARKETPLACE_REF
    ) {
      throw new ProvisioningError(
        `Claude marketplace '${name}' is configured from a different source; expected ${url}#${MARKETPLACE_REF}.`,
      );
    }
    await updateClaudeMarketplace(name, context);
    return { added: false };
  },
};

const codexOps: PluginClientOps = {
  listPlugins: (context) => listCodexPlugins(context),
  installPlugin: (id, context) => installCodexPlugin(id, context),
  // codex has no plugin-level update verb. Re-adding an installed plugin is
  // idempotent and re-resolves its version from the marketplace snapshot that
  // ensureMarketplace just refreshed (verified against the codex CLI: `plugin
  // add` on an installed plugin succeeds and reports the resolved version).
  upgradePlugin: (id, context) => installCodexPlugin(id, context),
  uninstallPlugin: (id, context) => removeCodexPlugin(id, context),
  async listMarketplaces(context) {
    const sources = await listCodexMarketplaces(context);
    return new Map(
      [...sources].map(([name, url]) => [name, { url, ref: undefined }]),
    );
  },
  removeMarketplace: (name, context) => removeCodexMarketplace(name, context),
  // `codex plugin marketplace add` is itself the presence probe, so this never
  // lists registrations and the cache stays unread until an ownership check
  // needs it.
  async ensureMarketplace(name, _repo, url, context, cache) {
    const alreadyAdded = await ensureCodexMarketplace(url, context);
    if (alreadyAdded) {
      await upgradeCodexMarketplace(name, context);
    } else {
      cache.record(name, { url, ref: undefined });
    }
    return { added: !alreadyAdded };
  },
};

export const pluginClientOps: Readonly<Record<PluginClient, PluginClientOps>> =
  {
    claude: claudeOps,
    codex: codexOps,
  };
