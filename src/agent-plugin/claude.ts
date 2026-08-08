import { ProvisioningError } from '../errors';
import { runProcessStep } from '../host/command-run';
import type { Context } from '../host/context';
import { isRecord } from '../host/parse';
import { capturePluginJson } from './output';

export interface ClaudeMarketplace {
  readonly source: string;
  readonly url: string | undefined;
  readonly ref: string | undefined;
}

/**
 * Installed plugin ids mapped to their reported version. The version is kept
 * optional because only the id is contractual; update mode uses the version to
 * classify an update as changed or unchanged when the client reports it.
 */
export async function listClaudePlugins(
  context: Context,
): Promise<Map<string, string | undefined>> {
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
  const installed = new Map<string, string | undefined>();
  for (const [index, entry] of raw.entries()) {
    if (!isRecord(entry) || typeof entry['id'] !== 'string') {
      throw new ProvisioningError(
        `Claude plugin inventory entry ${index + 1} requires a string id.`,
      );
    }
    installed.set(
      entry['id'],
      typeof entry['version'] === 'string' ? entry['version'] : undefined,
    );
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
    ['plugin', 'marketplace', 'add', `${url}#main`],
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
