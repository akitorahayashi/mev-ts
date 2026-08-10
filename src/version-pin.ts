/**
 * The pinned-versus-latest policy shared by every ecosystem mev installs from:
 * pipx tools, pnpm global packages, and GitHub release binaries. The three
 * manifests spell versions differently (PEP 440, semver, release tags) and keep
 * their own parsers, but they answer "is this entry latest-assumed, and what
 * does that imply" identically — so that answer lives here rather than being
 * restated per ecosystem, where a policy change would mean four coordinated
 * edits and a chance for one to drift.
 */

/** The sole latest-assumed vocabulary. Every other version is an exact pin. */
export const LATEST = 'latest';

/**
 * Whether a declared version must be (re)installed. An absent install always
 * needs one; a pin that diverges from what is installed needs one; a
 * latest-assumed entry does not, because the installed version is by definition
 * whatever `latest` last resolved to.
 */
export function needsInstall(
  declared: string,
  installedVersion: string | undefined,
): boolean {
  if (installedVersion === undefined) return true;
  return declared !== LATEST && declared !== installedVersion;
}

/**
 * Whether upgrade mode re-resolves this entry. A pin is never upgraded — a pin
 * that diverges from the installed version is a reinstall, not an upgrade — and
 * an entry that is not installed at all is an install, not an upgrade.
 */
export function shouldUpgrade(
  declared: string,
  isInstalled: boolean,
  upgrade: boolean,
): boolean {
  return upgrade && isInstalled && declared === LATEST;
}
