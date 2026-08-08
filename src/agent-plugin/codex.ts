import { ProvisioningError } from '../errors';
import type { Context } from '../host/context';
import { isRecord } from '../host/parse';
import { capturePluginJson } from './output';

export async function listCodexPlugins(context: Context): Promise<Set<string>> {
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
  const installed = new Set<string>();
  for (const [index, entry] of raw['installed'].entries()) {
    if (!isRecord(entry) || typeof entry['pluginId'] !== 'string') {
      throw new ProvisioningError(
        `Codex plugin inventory entry ${index + 1} requires a string pluginId.`,
      );
    }
    installed.add(entry['pluginId']);
  }
  return installed;
}

export async function ensureCodexMarketplace(
  url: string,
  context: Context,
): Promise<boolean> {
  const raw = await capturePluginJson(
    context.commands,
    'codex',
    ['plugin', 'marketplace', 'add', url, '--ref', 'main', '--json'],
    `Codex marketplace add ${url}`,
  );
  if (!isRecord(raw) || typeof raw['alreadyAdded'] !== 'boolean') {
    throw new ProvisioningError(
      'Codex marketplace add result requires an alreadyAdded boolean.',
    );
  }
  return raw['alreadyAdded'];
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
