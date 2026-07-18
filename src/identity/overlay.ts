import { join } from 'node:path';
import { lstatIfPresent } from '../host/absence';
import type { CommandRunner } from '../host/command';
import {
  configGet,
  configGetFile,
  configSetFile,
} from '../internal/git/config';

const identityKeys = ['user.name', 'user.email'] as const;

export interface IdentityOverlayDeps {
  readonly home: string;
  readonly run: CommandRunner;
}

/** The mutable global Git config that overrides mev's managed XDG config. */
export function identityOverlayPath(home: string): string {
  return join(home, '.gitconfig');
}

/**
 * Move identity keys that Git currently resolves globally into the mutable
 * overlay before provisioning can replace the managed XDG config. Existing
 * overlay values already have higher precedence and remain untouched.
 */
export async function preserveIdentityOverlay(
  deps: IdentityOverlayDeps,
  managedConfigPath: string,
): Promise<void> {
  if ((await lstatIfPresent(managedConfigPath)) === null) return;

  const overlay = identityOverlayPath(deps.home);
  const overlayExists = (await lstatIfPresent(overlay)) !== null;
  const missing: { key: (typeof identityKeys)[number]; value: string }[] = [];

  for (const key of identityKeys) {
    if (
      overlayExists &&
      (await configGetFile(deps.run, overlay, key)) !== null
    ) {
      continue;
    }
    const value = await configGet(deps.run, key);
    if (value !== null) missing.push({ key, value });
  }

  for (const { key, value } of missing) {
    await configSetFile(deps.run, overlay, key, value);
  }
}
