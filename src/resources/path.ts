import { join } from 'node:path';

/**
 * A destination path on the host, kept symbolic until execution so that
 * manifests stay pure and resource ids are stable regardless of the running
 * user's home directory.
 */
export type HostPath =
  | { readonly kind: 'home'; readonly rel: string }
  | { readonly kind: 'absolute'; readonly path: string };

export function home(rel: string): HostPath {
  return { kind: 'home', rel };
}

export function absolute(path: string): HostPath {
  return { kind: 'absolute', path };
}

/** Stable, home-independent rendering used for resource ids and display. */
export function symbolic(target: HostPath): string {
  return target.kind === 'home' ? `~/${target.rel}` : target.path;
}

/** Concrete filesystem path, resolved against the running user's home. */
export function resolveHostPath(target: HostPath, homeDir: string): string {
  return target.kind === 'home' ? join(homeDir, target.rel) : target.path;
}
