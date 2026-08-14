import { ProvisioningError } from '../errors';
import { runProcessStep } from '../host/command-run';
import type { Context } from '../host/context';
import { isRecord } from '../host/parse';
import { MARKETPLACE_REF } from './catalog';
import { decodeInstalledPlugin, type PluginInventory } from './inventory';
import { capturePluginJson } from './output';

/**
 * Installed plugins mapped to what codex reports about each. The version is kept
 * optional because only the pluginId and enablement are contractual; upgrade mode
 * uses the version to classify an upgrade as changed or unchanged when reported.
 */
export async function listCodexPlugins(
  context: Context,
): Promise<PluginInventory> {
  const raw = await capturePluginJson(
    context.commands,
    'codex',
    ['plugin', 'list', '--json'],
    'Codex plugin inventory',
  );
  if (!isRecord(raw) || !Array.isArray(raw['installed'])) {
    throw new ProvisioningError(
      'Codex plugin inventory requires an installed array.',
    );
  }
  const installed: PluginInventory = new Map();
  for (const [index, entry] of raw['installed'].entries()) {
    const decoded = decodeInstalledPlugin(entry, 'pluginId');
    if (decoded === null) {
      throw new ProvisioningError(
        `Codex plugin inventory entry ${index + 1} requires a string pluginId and a boolean enabled field.`,
      );
    }
    installed.set(decoded.id, decoded.plugin);
  }
  return installed;
}

/**
 * Register the marketplace at the pinned ref. Codex refuses a name already
 * held from a different source, so callers classify the registration from the
 * listing first; the reported `alreadyAdded` therefore only ever restates a
 * same-source re-add and is not read.
 */
export async function addCodexMarketplace(
  url: string,
  context: Context,
): Promise<void> {
  const raw = await capturePluginJson(
    context.commands,
    'codex',
    ['plugin', 'marketplace', 'add', url, '--ref', MARKETPLACE_REF, '--json'],
    `Codex marketplace add ${url}`,
  );
  if (!isRecord(raw) || typeof raw['alreadyAdded'] !== 'boolean') {
    throw new ProvisioningError(
      'Codex marketplace add result requires an alreadyAdded boolean.',
    );
  }
}

export async function upgradeCodexMarketplace(
  name: string,
  context: Context,
): Promise<void> {
  await capturePluginJson(
    context.commands,
    'codex',
    ['plugin', 'marketplace', 'upgrade', name, '--json'],
    `Codex marketplace upgrade ${name}`,
  );
}

export async function installCodexPlugin(
  id: string,
  context: Context,
): Promise<void> {
  await capturePluginJson(
    context.commands,
    'codex',
    ['plugin', 'add', id, '--json'],
    `Codex plugin install ${id}`,
  );
}

/**
 * Registered marketplace names mapped to their source URL, for verifying a
 * declarative removal against the tombstone's repository. Built-in
 * marketplaces carry no marketplaceSource and map to undefined, which removal
 * treats as a foreign source.
 */
export async function listCodexMarketplaces(
  context: Context,
): Promise<Map<string, string | undefined>> {
  const raw = await capturePluginJson(
    context.commands,
    'codex',
    ['plugin', 'marketplace', 'list', '--json'],
    'Codex marketplace inventory',
  );
  if (!isRecord(raw) || !Array.isArray(raw['marketplaces'])) {
    throw new ProvisioningError(
      'Codex marketplace inventory requires a marketplaces array.',
    );
  }
  const marketplaces = new Map<string, string | undefined>();
  for (const [index, entry] of raw['marketplaces'].entries()) {
    if (!isRecord(entry) || typeof entry['name'] !== 'string') {
      throw new ProvisioningError(
        `Codex marketplace inventory entry ${index + 1} requires a string name.`,
      );
    }
    const source = entry['marketplaceSource'];
    marketplaces.set(
      entry['name'],
      isRecord(source) && typeof source['source'] === 'string'
        ? source['source']
        : undefined,
    );
  }
  return marketplaces;
}

// `codex plugin remove` documents no --json flag, unlike its siblings.
export async function removeCodexPlugin(
  id: string,
  context: Context,
): Promise<void> {
  await runProcessStep(
    context.commands,
    'codex',
    ['plugin', 'remove', id],
    `Codex plugin remove ${id}`,
  );
}

export async function removeCodexMarketplace(
  name: string,
  context: Context,
): Promise<void> {
  await capturePluginJson(
    context.commands,
    'codex',
    ['plugin', 'marketplace', 'remove', name, '--json'],
    `Codex marketplace remove ${name}`,
  );
}
