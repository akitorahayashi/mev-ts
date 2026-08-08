import type { InstalledPackage } from './inventory';
import { latestVersion, type PnpmPackage } from './manifest';

export function installSpec(pkg: PnpmPackage): string {
  return `${pkg.name}@${pkg.version}`;
}

/**
 * `pnpm add -g` replaces an existing install in place, so a pin mismatch is a
 * single re-add rather than a remove/add pair.
 */
export function needsInstall(
  pkg: PnpmPackage,
  installed: InstalledPackage | undefined,
): boolean {
  if (!installed) return true;
  return pkg.version !== latestVersion && pkg.version !== installed.version;
}

/**
 * `latest` is the only latest-assumed vocabulary, so a pinned package is never
 * upgraded; re-resolution happens only in update mode.
 */
export function shouldUpgrade(
  pkg: PnpmPackage,
  installed: InstalledPackage | undefined,
  update: boolean,
): boolean {
  return update && installed !== undefined && pkg.version === latestVersion;
}
