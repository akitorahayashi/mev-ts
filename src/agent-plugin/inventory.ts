import { isRecord } from '../host/parse';

/**
 * What a client reports about one installed plugin. Both fields are read as
 * desired state: a plugin the catalog declares must be present *and* enabled,
 * because an installed-but-disabled plugin contributes nothing to the client.
 * Owned here rather than in `client.ts` so both protocol modules and the
 * capability dispatch above them depend downward on one shape.
 */
export interface InstalledPlugin {
  /**
   * Absent when the client reports no version. Only upgrade classification reads
   * it, and it cannot prove a no-op without a version on both sides.
   */
  readonly version: string | undefined;
  readonly enabled: boolean;
}

export type PluginInventory = Map<string, InstalledPlugin>;

/**
 * Decode one client-reported entry into the shared shape, given the client's
 * spelling of the id field. Returns null when the contractual fields are
 * missing, so each protocol module raises its own labeled error naming its
 * client's vocabulary.
 */
export function decodeInstalledPlugin(
  entry: unknown,
  idField: string,
): { readonly id: string; readonly plugin: InstalledPlugin } | null {
  if (!isRecord(entry)) return null;
  const id = entry[idField];
  if (typeof id !== 'string' || typeof entry['enabled'] !== 'boolean') {
    return null;
  }
  return {
    id,
    plugin: {
      version:
        typeof entry['version'] === 'string' ? entry['version'] : undefined,
      enabled: entry['enabled'],
    },
  };
}
