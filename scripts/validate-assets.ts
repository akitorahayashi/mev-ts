import { embeddedAssets } from '../src/assets/registry';
import { errorMessage } from '../src/errors';
import { validateEmbeddedAssets } from '../src/provisioning/preflight';

if (import.meta.main) {
  try {
    await validateEmbeddedAssets(embeddedAssets);
  } catch (error) {
    console.error(errorMessage(error));
    process.exit(1);
  }
}
