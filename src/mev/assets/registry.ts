import { ProvisioningError } from '../errors';
import type { AssetSource } from '../resources/model';
import { assetContents } from './registry.generated';

/**
 * Embedded configuration assets, keyed by their path under the deployed config
 * root. The map is generated from `src/mev/assets/files/` by
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
};

/** All embedded asset keys whose path begins with the given prefix. */
export function assetKeysByPrefix(prefix: string): string[] {
  return Object.keys(assetContents)
    .filter((key) => key.startsWith(prefix))
    .sort();
}
