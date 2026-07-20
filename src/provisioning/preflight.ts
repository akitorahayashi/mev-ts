import { join } from 'node:path';
import type { AssetSource } from '../assets/registry';
import { parseSectionCatalog } from '../coder/catalog';
import { parseDefaults } from '../defaults/manifest';
import { parseAssociations } from '../duti/association';
import { parseExtensions } from '../editor/extension';
import { errorMessage, ProvisioningError } from '../errors';
import { parseReleaseBinaries } from '../github/release';
import { parseTools } from '../pipx/manifest';
import { parseJsonObject } from '../zed/settings';
import type { Activation } from './activation/contract';
import { allTargets } from './registry';
import type { Target } from './target';

type AssetValidator = (raw: string, key: string, assets: AssetSource) => void;

function validatorFor(activation: Activation): AssetValidator | null {
  switch (activation.kind) {
    case 'defaults':
      return (raw, key) => {
        parseDefaults(raw, key);
      };
    case 'duti':
      return (raw, key) => {
        parseAssociations(raw, key);
      };
    case 'pipx':
      return (raw, key) => {
        parseTools(raw, key);
      };
    case 'editorExtensions':
      return (raw, key) => {
        parseExtensions(raw, key);
      };
    case 'release':
      return (raw, key) => {
        parseReleaseBinaries(raw, key);
      };
    case 'coderAgents':
      return (raw, key) => {
        parseSectionCatalog(raw, key);
      };
    case 'zedSettings':
      return (raw, key) => {
        parseJsonObject(raw, key, 'Zed base settings');
      };
    default:
      return null;
  }
}

async function validateAsset(
  key: string,
  assets: AssetSource,
  validator: AssetValidator,
): Promise<void> {
  try {
    validator(await assets.read(key), key, assets);
  } catch (error) {
    throw new ProvisioningError(
      `Embedded asset preflight failed for ${key}: ${errorMessage(error)}`,
    );
  }
}

async function validateActivation(
  activation: Activation,
  assets: AssetSource,
): Promise<void> {
  const validator = validatorFor(activation);
  if (validator) {
    const key =
      activation.kind === 'coderAgents'
        ? join(activation.sectionsPrefix, 'catalog.yml')
        : activation.kind === 'zedSettings'
          ? activation.base.key
          : 'configKey' in activation
            ? activation.configKey
            : '';
    await validateAsset(key, assets, validator);
  }
  if (activation.kind === 'command') {
    for (const read of Object.values(activation.reads ?? {})) {
      if (typeof read === 'string') continue;
      await validateAsset(read.key, assets, (raw, key) => {
        read.validate(raw, key);
      });
    }
  }
  if (activation.kind === 'zedSettings') {
    for (const key of assets.keysByPrefix(`${activation.overridesPrefix}/`)) {
      await validateAsset(key, assets, (raw, assetKey) => {
        parseJsonObject(raw, assetKey, 'Zed override');
      });
    }
  }
}

export async function validateEmbeddedAssets(
  assets: AssetSource,
  targets: readonly Target[] = allTargets(),
): Promise<void> {
  for (const target of targets) {
    for (const activation of target.activations) {
      await validateActivation(activation, assets);
    }
  }
}
