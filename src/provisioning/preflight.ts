import type { AssetSource } from '../assets/registry';
import { parseSectionCatalog, reconcileSections } from '../coder/catalog';
import { parseDefaults } from '../defaults/manifest';
import { parseAssociations } from '../duti/association';
import { parseExtensions } from '../editor/extension';
import { errorMessage, ProvisioningError } from '../errors';
import {
  parseReleaseBinaries,
  parseReleaseLock,
  releaseArchitectures,
  releaseLockKey,
  resolveReleaseDigest,
} from '../github/release';
import { parseTools } from '../pipx/manifest';
import { parseJsonObject } from '../zed/settings';
import {
  bindCommandRead,
  coderAgentsConfigAssets,
  commandReadKey,
  defaultsConfigAssets,
  dutiConfigAssets,
  extensionsConfigAssets,
  pipxConfigAssets,
  releaseConfigAssets,
  zedSettingsConfigAssets,
} from './activation';
import type { Activation } from './activation/contract';
import { allTargets } from './registry';
import type { Target } from './target';

type AssetValidator = (
  raw: string,
  key: string,
  assets: AssetSource,
) => void | Promise<void>;

/** The embedded config assets an activation kind validates, and how. */
interface AssetCheck {
  readonly keys: readonly string[];
  readonly validate: AssetValidator;
}

/**
 * The config assets a kind validates before provisioning, with each kind naming
 * its own keys (via its `configAssets`) rather than preflight guessing them. The
 * switch has no `default`, so a new kind is a compile-time prompt to declare its
 * check here. Kinds without an embedded config asset to validate — including
 * `coderSkills`, whose skills tree is a filesystem-derived catalog with no
 * build-time schema — return null explicitly; the zed override fragments are
 * validated separately below.
 */
function assetCheckFor(activation: Activation): AssetCheck | null {
  switch (activation.kind) {
    case 'defaults':
      return {
        keys: defaultsConfigAssets(activation),
        validate: (raw, key) => {
          parseDefaults(raw, key);
        },
      };
    case 'duti':
      return {
        keys: dutiConfigAssets(activation),
        validate: (raw, key) => {
          parseAssociations(raw, key);
        },
      };
    case 'pipx':
      return {
        keys: pipxConfigAssets(activation),
        validate: (raw, key) => {
          parseTools(raw, key);
        },
      };
    case 'editorExtensions':
      return {
        keys: extensionsConfigAssets(activation),
        validate: (raw, key) => {
          parseExtensions(raw, key);
        },
      };
    case 'release': {
      // Beyond per-file parsing, the manifest must be fully covered by its
      // digest lock, so a manifest edit without `bun run lock` fails at build
      // time rather than per binary during provisioning.
      const lockKey = releaseLockKey(activation.configKey);
      return {
        keys: releaseConfigAssets(activation),
        validate: async (raw, key, assets) => {
          if (key === lockKey) {
            parseReleaseLock(raw, key);
            return;
          }
          const binaries = parseReleaseBinaries(raw, key);
          const lock = parseReleaseLock(await assets.read(lockKey), lockKey);
          for (const binary of binaries) {
            for (const arch of releaseArchitectures) {
              resolveReleaseDigest(binary, arch, lock);
            }
          }
        },
      };
    }
    case 'coderAgents':
      return {
        keys: coderAgentsConfigAssets(activation),
        validate: (raw, key, assets) => {
          const listed = parseSectionCatalog(raw, key);
          const prefix = `${activation.sectionsPrefix}/`;
          const presentStems = assets
            .keysByPrefix(prefix)
            .map((assetKey) => assetKey.slice(prefix.length))
            .filter((name) => name.endsWith('.md') && !name.includes('/'))
            .map((name) => name.slice(0, -'.md'.length));
          reconcileSections(listed, presentStems);
        },
      };
    case 'zedSettings':
      return {
        keys: zedSettingsConfigAssets(activation),
        validate: (raw, key) => {
          parseJsonObject(raw, key, 'Zed base settings');
        },
      };
    case 'file':
    case 'tree':
    case 'command':
    case 'remoteInstaller':
    case 'coderSkills':
      return null;
  }
}

async function validateAsset(
  key: string,
  assets: AssetSource,
  validator: AssetValidator,
): Promise<void> {
  try {
    await validator(await assets.read(key), key, assets);
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
  const check = assetCheckFor(activation);
  if (check) {
    for (const key of check.keys) {
      await validateAsset(key, assets, check.validate);
    }
  }
  if (activation.kind === 'command') {
    // Read and bind every declared key exactly as runtime will, so a missing
    // asset (including a bare-string read) and any `validate`/`derive` rejection
    // surface here rather than only during provisioning.
    for (const read of Object.values(activation.reads ?? {})) {
      await validateAsset(commandReadKey(read), assets, (raw) => {
        bindCommandRead(read, raw);
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
