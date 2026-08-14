import { errorMessage, ProvisioningError } from '../errors';
import type { Repository } from '../github/repository';
import { remoteMatchesRepository } from '../github/repository';
import type { Context } from '../host/context';
import { MARKETPLACE_REF, type PluginClient } from './catalog';
import {
  addClaudeMarketplace,
  enableClaudePlugin,
  installClaudePlugin,
  listClaudeMarketplaces,
  listClaudePlugins,
  removeClaudeMarketplace,
  uninstallClaudePlugin,
  updateClaudeMarketplace,
  updateClaudePlugin,
} from './claude';
import {
  addCodexMarketplace,
  installCodexPlugin,
  listCodexMarketplaces,
  listCodexPlugins,
  removeCodexMarketplace,
  removeCodexPlugin,
  upgradeCodexMarketplace,
} from './codex';
import type { PluginInventory } from './inventory';

/** One registered marketplace as the host reports it. */
export interface MarketplaceRegistration {
  /** The git remote, absent when the registration is not a git source. */
  readonly url: string | undefined;
  /** The tracked ref, absent for clients that do not report one. */
  readonly ref: string | undefined;
}

export type MarketplaceRemotes = Map<string, MarketplaceRegistration>;

/**
 * How an ensure converged: registered anew, re-registered over a drifted
 * source (a stale SSH alias or an unpinned ref), or refreshed in place.
 */
export type EnsureOutcome = 'added' | 'reregistered' | 'refreshed';

/**
 * One client's registered marketplaces, listed at most once per run. Handed to
 * `ensureMarketplace` rather than pre-fetched by the caller, because only a
 * client that must inspect existing registrations should pay for listing them.
 */
export interface RegistrationCache {
  current(): Promise<MarketplaceRemotes>;
  record(name: string, registration: MarketplaceRegistration): void;
  forget(name: string): void;
}

/**
 * A convergence that destroyed state before failing: the marketplace and the
 * plugins installed from it were removed, but registering the replacement
 * failed. Its own type so the activation invalidates the namespace's
 * inventory instead of reporting the dropped plugins as still installed.
 */
export class DroppedPluginsError extends ProvisioningError {}

/**
 * The plugin operations every supported client provides, keyed by client. The
 * two CLIs spell the same operations differently — codex has neither a
 * plugin-level update nor an enable verb, and only claude reports a ref
 * alongside a marketplace source — and those differences are absorbed here, in
 * the capability layer that owns each tool's protocol. The activation performs
 * lookups, so adding a third client is one entry rather than an edit to every
 * dispatch site.
 */
export interface PluginClientOps {
  listPlugins(context: Context): Promise<PluginInventory>;
  installPlugin(id: string, context: Context): Promise<void>;
  /**
   * Enable an installed-but-disabled plugin. Issued only for a plugin the
   * inventory reported disabled, and always settled by the post-run inventory
   * rather than by the command's exit status.
   */
  enablePlugin(id: string, context: Context): Promise<void>;
  upgradePlugin(id: string, context: Context): Promise<void>;
  /**
   * Whether `upgradePlugin` also enables a disabled plugin, so the reconcile
   * loop skips a redundant enable command after an upgrade. The verb overlap is
   * a fact about the client's CLI, so it lives here in the capability table
   * rather than being inferred in the activation.
   */
  readonly upgradeEnables: boolean;
  uninstallPlugin(id: string, context: Context): Promise<void>;
  listMarketplaces(context: Context): Promise<MarketplaceRemotes>;
  removeMarketplace(name: string, context: Context): Promise<void>;
  /**
   * Whether a listed registration already matches the declared source, so a
   * fully-installed marketplace can hold still. Claude records url and ref;
   * codex reports only the source url, so its ref cannot be compared and the
   * `--ref` pin every add carries is trusted instead.
   */
  registrationMatches(current: MarketplaceRegistration, url: string): boolean;
  /**
   * Converge the marketplace registration on the declared source: register it
   * if absent, re-register it over a drifted url or ref, otherwise refresh it,
   * reporting which happened. A same-named marketplace holding a different
   * repository is a conflict and throws — identity is not mev's to overwrite.
   * Any new registration is recorded in `cache` so a later ownership probe
   * sees it.
   */
  ensureMarketplace(
    name: string,
    repo: Repository,
    url: string,
    context: Context,
    cache: RegistrationCache,
  ): Promise<EnsuredRegistration>;
}

export interface EnsuredRegistration {
  readonly outcome: EnsureOutcome;
  /**
   * Whether converging the registration also uninstalled the plugins that
   * were installed from it, so the caller reinstalls them rather than
   * standing on a pre-run inventory the operation invalidated.
   */
  readonly droppedPlugins: boolean;
}

const claudeOps: PluginClientOps = {
  listPlugins: (context) => listClaudePlugins(context),
  installPlugin: (id, context) => installClaudePlugin(id, context),
  enablePlugin: (id, context) => enableClaudePlugin(id, context),
  upgradePlugin: (id, context) => updateClaudePlugin(id, context),
  // `plugin update` leaves enablement alone, so a disabled plugin still needs
  // the enable verb after an upgrade.
  upgradeEnables: false,
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
  registrationMatches: (current, url) =>
    current.url === url && current.ref === MARKETPLACE_REF,
  async ensureMarketplace(name, repo, url, context, cache) {
    const current = (await cache.current()).get(name);
    if (!current) {
      await addClaudeMarketplace(url, context);
      cache.record(name, { url, ref: MARKETPLACE_REF });
      return { outcome: 'added', droppedPlugins: false };
    }
    if (!remoteMatchesRepository(current.url, repo)) {
      throw new ProvisioningError(
        `Claude marketplace '${name}' is registered for a different repository; expected ${url}#${MARKETPLACE_REF}, found ${current.url ?? 'a non-git source'}.`,
      );
    }
    // The same repository under a stale SSH alias or without the ref pin is
    // drift within mev's ownership. `marketplace add` rewrites an existing
    // registration's source and ref in place and keeps its installed plugins,
    // so no removal is involved — which also avoids failing on a registration
    // held outside the user scope removal pins.
    if (current.url !== url || current.ref !== MARKETPLACE_REF) {
      await addClaudeMarketplace(url, context);
      cache.record(name, { url, ref: MARKETPLACE_REF });
      return { outcome: 'reregistered', droppedPlugins: false };
    }
    await updateClaudeMarketplace(name, context);
    return { outcome: 'refreshed', droppedPlugins: false };
  },
};

const codexOps: PluginClientOps = {
  listPlugins: (context) => listCodexPlugins(context),
  installPlugin: (id, context) => installCodexPlugin(id, context),
  // codex has neither an enable nor a plugin-level update verb; `plugin add` is
  // both. Verified against the codex CLI: re-adding an installed plugin succeeds,
  // reports the version re-resolved from the marketplace snapshot that
  // ensureMarketplace just refreshed, and sets `plugins.<id>.enabled = true` — so
  // it converges a plugin disabled in `~/.codex/config.toml`.
  enablePlugin: (id, context) => installCodexPlugin(id, context),
  upgradePlugin: (id, context) => installCodexPlugin(id, context),
  upgradeEnables: true,
  uninstallPlugin: (id, context) => removeCodexPlugin(id, context),
  async listMarketplaces(context) {
    const sources = await listCodexMarketplaces(context);
    return new Map(
      [...sources].map(([name, url]) => [name, { url, ref: undefined }]),
    );
  },
  removeMarketplace: (name, context) => removeCodexMarketplace(name, context),
  registrationMatches: (current, url) => current.url === url,
  // Codex refuses `marketplace add` for a name already held from another
  // source, so the registration listing — not the add — is what classifies
  // drift here.
  async ensureMarketplace(name, repo, url, context, cache) {
    const current = (await cache.current()).get(name);
    if (!current) {
      await addCodexMarketplace(url, context);
      cache.record(name, { url, ref: undefined });
      return { outcome: 'added', droppedPlugins: false };
    }
    if (!remoteMatchesRepository(current.url, repo)) {
      throw new ProvisioningError(
        `Codex marketplace '${name}' is registered for a different repository; expected ${url}, found ${current.url ?? 'a non-git source'}.`,
      );
    }
    // Removing a codex marketplace uninstalls the plugins installed from it
    // (verified against the CLI), which is why the drop is reported: the
    // declared plugins are reinstalled from the re-registered source.
    if (current.url !== url) {
      await removeCodexMarketplace(name, context);
      // From here the host state is already destroyed, so a failing add must
      // not leave the caller's view pre-removal: the cache drops the
      // registration now, and the failure is typed as a plugin-dropping one.
      cache.forget(name);
      try {
        await addCodexMarketplace(url, context);
      } catch (error) {
        throw new DroppedPluginsError(
          `Codex marketplace '${name}' was removed for re-registration, uninstalling its plugins, but adding ${url} failed: ${errorMessage(error)}`,
        );
      }
      cache.record(name, { url, ref: undefined });
      return { outcome: 'reregistered', droppedPlugins: true };
    }
    await upgradeCodexMarketplace(name, context);
    return { outcome: 'refreshed', droppedPlugins: false };
  },
};

export const pluginClientOps: Readonly<Record<PluginClient, PluginClientOps>> =
  {
    claude: claudeOps,
    codex: codexOps,
  };
