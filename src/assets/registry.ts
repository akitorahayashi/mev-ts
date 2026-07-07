import { ProvisioningError } from '../errors';
import { assetContents, executableAssets } from './registry.generated';

/** Read access to embedded assets, plus enumeration of a deploy role's files. */
export interface AssetSource {
  read(key: string): Promise<string>;
  keysByPrefix(prefix: string): readonly string[];
  /** Whether the asset's source carried the owner-execute bit. */
  isExecutable(key: string): boolean;
}

const executableKeys = new Set(executableAssets);

/**
 * Embedded configuration assets, keyed by their path under the deployed config
 * root. The map is generated from `src/assets/config/` by
 * `scripts/generate-assets.ts`, so the source tree is the single authority for
 * what ships in the binary.
 */
export const embeddedAssets: AssetSource = {
  async read(key): Promise<string> {
    const content = assetContents[key];
    if (content === undefined) {
      throw new ProvisioningError(`Unknown asset '${key}'.`);
    }
    return content;
  },
  keysByPrefix(prefix): readonly string[] {
    return Object.keys(assetContents)
      .filter((key) => key.startsWith(prefix))
      .sort();
  },
  isExecutable(key): boolean {
    return executableKeys.has(key);
  },
};
