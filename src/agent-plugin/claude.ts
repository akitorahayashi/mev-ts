import { ProvisioningError } from '../errors';
import { runProcessStep } from '../host/command-run';
import type { Context } from '../host/context';
import { isRecord } from '../host/parse';
import { MARKETPLACE_REF } from './catalog';
import { decodeInstalledPlugin, type PluginInventory } from './inventory';
import { capturePluginJson } from './output';

export interface ClaudeMarketplace {
  readonly source: string;
  readonly url: string | undefined;
  readonly ref: string | undefined;
}

/**
 * Installed user-scope plugins mapped to what the client reports about each.
 * Project and local scope entries are dropped: mev installs and uninstalls only
 * in the user scope, so a same-id plugin in another scope must neither satisfy
 * an install nor fail an uninstall verification. The version is kept optional
 * because only the id and enablement are contractual; upgrade mode uses the
 * version to classify an upgrade as changed or unchanged when reported.
 */
export async function listClaudePlugins(
  context: Context,
): Promise<PluginInventory> {
  const raw = await capturePluginJson(
    context.commands,
    'claude',
    ['plugin', 'list', '--json'],
    'Claude plugin inventory',
  );
  if (!Array.isArray(raw)) {
    throw new ProvisioningError(
      'Claude plugin inventory must be a JSON array.',
    );
  }
  const installed: PluginInventory = new Map();
  for (const [index, entry] of raw.entries()) {
    const decoded = decodeInstalledPlugin(entry, 'id');
    const scope = isRecord(entry) ? entry['scope'] : undefined;
    if (decoded === null || typeof scope !== 'string') {
      throw new ProvisioningError(
        `Claude plugin inventory entry ${index + 1} requires string id and scope fields and a boolean enabled field.`,
      );
    }
    if (scope !== 'user') continue;
    installed.set(decoded.id, decoded.plugin);
  }
  return installed;
}

export async function listClaudeMarketplaces(
  context: Context,
): Promise<Map<string, ClaudeMarketplace>> {
  const raw = await capturePluginJson(
    context.commands,
    'claude',
    ['plugin', 'marketplace', 'list', '--json'],
    'Claude marketplace inventory',
  );
  if (!Array.isArray(raw)) {
    throw new ProvisioningError(
      'Claude marketplace inventory must be a JSON array.',
    );
  }
  const marketplaces = new Map<string, ClaudeMarketplace>();
  for (const [index, entry] of raw.entries()) {
    if (
      !isRecord(entry) ||
      typeof entry['name'] !== 'string' ||
      typeof entry['source'] !== 'string'
    ) {
      throw new ProvisioningError(
        `Claude marketplace inventory entry ${index + 1} requires string name and source fields.`,
      );
    }
    marketplaces.set(entry['name'], {
      source: entry['source'],
      url: typeof entry['url'] === 'string' ? entry['url'] : undefined,
      ref: typeof entry['ref'] === 'string' ? entry['ref'] : undefined,
    });
  }
  return marketplaces;
}

export async function addClaudeMarketplace(
  url: string,
  context: Context,
): Promise<void> {
  await runProcessStep(
    context.commands,
    'claude',
    ['plugin', 'marketplace', 'add', `${url}#${MARKETPLACE_REF}`],
    `Claude marketplace add ${url}`,
  );
}

export async function updateClaudeMarketplace(
  name: string,
  context: Context,
): Promise<void> {
  await runProcessStep(
    context.commands,
    'claude',
    ['plugin', 'marketplace', 'update', name],
    `Claude marketplace update ${name}`,
  );
}

export async function installClaudePlugin(
  id: string,
  context: Context,
): Promise<void> {
  await runProcessStep(
    context.commands,
    'claude',
    ['plugin', 'install', id],
    `Claude plugin install ${id}`,
  );
}

// Only ever issued for a plugin the inventory reported disabled: the verb exits
// non-zero on an already-enabled plugin (verified against the claude CLI), so a
// presence-only caller would turn every converged run into a failure.
export async function enableClaudePlugin(
  id: string,
  context: Context,
): Promise<void> {
  await runProcessStep(
    context.commands,
    'claude',
    ['plugin', 'enable', id, '--scope', 'user'],
    `Claude plugin enable ${id}`,
  );
}

export async function updateClaudePlugin(
  id: string,
  context: Context,
): Promise<void> {
  await runProcessStep(
    context.commands,
    'claude',
    ['plugin', 'update', id],
    `Claude plugin update ${id}`,
  );
}

// mev installs only into the user scope, so removals pin --scope user: both
// verbs default to acting on every scope (uninstall via its default, marketplace
// remove explicitly documented as all-scope when the flag is omitted).
export async function uninstallClaudePlugin(
  id: string,
  context: Context,
): Promise<void> {
  await runProcessStep(
    context.commands,
    'claude',
    ['plugin', 'uninstall', id, '--scope', 'user'],
    `Claude plugin uninstall ${id}`,
  );
}

export async function removeClaudeMarketplace(
  name: string,
  context: Context,
): Promise<void> {
  await runProcessStep(
    context.commands,
    'claude',
    ['plugin', 'marketplace', 'remove', name, '--scope', 'user'],
    `Claude marketplace remove ${name}`,
  );
}
