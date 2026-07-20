import { join } from 'node:path';

/**
 * Root, relative to the user's home, under which mev owns every path it
 * manages: the deploy store, generated entities, selection manifests, identity
 * state, and the symlink surface consumer configs reference. Sole authority for
 * that root; every mev-managed sub-path derives from it.
 */
export const mevRoot = '.mev';

/**
 * A destination path on the host, kept symbolic until execution so that
 * manifests stay pure and reports are stable regardless of the running user's
 * home directory.
 */
export type HostPath = { readonly kind: 'home'; readonly rel: string };

export function home(rel: string): HostPath {
  return { kind: 'home', rel };
}

/**
 * Compose a host path under the mev root (`~/.mev/...`). Sole builder for
 * mev-owned sub-paths, so no call site hardcodes the `.mev` literal.
 */
export function mevPath(...segments: string[]): HostPath {
  return home(join(mevRoot, ...segments));
}

/** Stable, home-independent rendering used for display. */
export function symbolic(target: HostPath): string {
  return `~/${target.rel}`;
}

/** Concrete filesystem path, resolved against the running user's home. */
export function resolveHostPath(target: HostPath, homeDir: string): string {
  return join(homeDir, target.rel);
}
