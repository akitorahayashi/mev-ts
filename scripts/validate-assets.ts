import { embeddedAssets, registrySourceHash } from '../src/assets/registry';
import { errorMessage } from '../src/errors';
import { validateEmbeddedAssets } from '../src/provisioning/preflight';
import { assetSourceHash, collectAssets } from './asset-registry';

if (import.meta.main) {
  try {
    // Freshness guard: fail loudly if the embedded registry no longer matches
    // the source tree, rather than letting a stale registry surface as confusing
    // downstream errors.
    const fresh = assetSourceHash(await collectAssets());
    if (fresh !== registrySourceHash) {
      throw new Error(
        'src/assets/registry.generated.ts is stale: its embedded hash does not match src/assets/config/. Run `bun run codegen`.',
      );
    }
    await validateEmbeddedAssets(embeddedAssets);
  } catch (error) {
    console.error(errorMessage(error));
    process.exit(1);
  }
}
