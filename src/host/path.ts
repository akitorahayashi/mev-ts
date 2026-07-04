import { join } from 'node:path';

/**
 * A destination path on the host, kept symbolic until execution so that
 * manifests stay pure and reports are stable regardless of the running user's
 * home directory.
 */
export type HostPath = { readonly kind: 'home'; readonly rel: string };

export function home(rel: string): HostPath {
  return { kind: 'home', rel };
}

/** Stable, home-independent rendering used for display. */
export function symbolic(target: HostPath): string {
  return `~/${target.rel}`;
}

/** Concrete filesystem path, resolved against the running user's home. */
export function resolveHostPath(target: HostPath, homeDir: string): string {
  return join(homeDir, target.rel);
}
