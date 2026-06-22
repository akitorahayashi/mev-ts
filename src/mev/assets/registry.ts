import { ProvisioningError } from '../errors';
import type { AssetSource } from '../resources/model';
import gitconfig from './git/global/gitconfig' with { type: 'file' };
import gitignoreGlobal from './git/global/gitignore_global' with {
  type: 'file',
};

/**
 * Embedded configuration assets, keyed by their deployed path under the config
 * root. Bun compiles these files into the standalone binary, so the values
 * resolve to readable paths both in development and in the compiled executable.
 */
const embedded: Record<string, string> = {
  'git/global/.gitconfig': gitconfig,
  'git/global/.gitignore_global': gitignoreGlobal,
};

export const embeddedAssets: AssetSource = {
  async read(key): Promise<string> {
    const path = embedded[key];
    if (path === undefined) {
      throw new ProvisioningError(`Unknown asset '${key}'.`);
    }
    return Bun.file(path).text();
  },
};
