import {
  needsInstall as pinNeedsInstall,
  shouldUpgrade as upgradesPin,
} from '../version-pin';
import type { InstalledPackage } from './inventory';
import type { PnpmPackage } from './manifest';

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
  return pinNeedsInstall(pkg.version, installed?.version);
}

export function shouldUpgrade(
  pkg: PnpmPackage,
  installed: InstalledPackage | undefined,
  upgrade: boolean,
): boolean {
  return upgradesPin(pkg.version, installed !== undefined, upgrade);
}
