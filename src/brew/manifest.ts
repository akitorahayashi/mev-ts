import { ProvisioningError } from '../errors';
import { type PackageRequirement, SAFE_TOKEN_NAME } from './package';

export const manifestName = 'Brewfile';

// Homebrew evaluates a Brewfile as Ruby, but mev reads only the declarations it
// installs token by token. Options, other directives, and Ruby expressions are
// refused rather than ignored, so a line mev cannot honor never looks applied.
// The accepted form matches `brew bundle dump` output, so a deployed Brewfile
// still works with `brew bundle check --file`.
const ENTRY = /^(tap|brew|cask)\s+"([^"]+)"\s*(?:#.*)?$/;

export function parseManifest(raw: string, path: string): PackageRequirement {
  const declared = {
    tap: [] as string[],
    brew: [] as string[],
    cask: [] as string[],
  };
  for (const [index, line] of raw.split('\n').entries()) {
    const entry = line.trim();
    if (entry === '' || entry.startsWith('#')) continue;
    const location = `${path}:${index + 1}`;
    const match = ENTRY.exec(entry);
    const kind = match?.[1];
    const name = match?.[2];
    if (
      name === undefined ||
      (kind !== 'tap' && kind !== 'brew' && kind !== 'cask')
    ) {
      throw new ProvisioningError(
        `Brewfile ${location} must declare one double-quoted tap, brew, or cask name without options: ${entry}`,
      );
    }
    if (!SAFE_TOKEN_NAME.test(name)) {
      throw new ProvisioningError(
        `Brewfile ${location} declares the unsafe name '${name}'; names may contain only letters, digits, and ._@/+- characters.`,
      );
    }
    if (declared[kind].includes(name)) {
      throw new ProvisioningError(
        `Brewfile ${location} declares ${kind} '${name}' more than once.`,
      );
    }
    declared[kind].push(name);
  }
  return {
    taps: declared.tap,
    formulae: declared.brew,
    casks: declared.cask,
  };
}
