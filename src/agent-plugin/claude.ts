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

export async function listClaudePlugins(
  context: Context,
): Promise<Set<string>> {
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
  const installed = new Set<string>();
  for (const [index, entry] of raw.entries()) {
    if (!isRecord(entry) || typeof entry['id'] !== 'string') {
      throw new ProvisioningError(
        `Claude plugin inventory entry ${index + 1} requires a string id.`,
      );
    }
    installed.add(entry['id']);
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
