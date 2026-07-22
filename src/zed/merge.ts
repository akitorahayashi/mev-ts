import { ProvisioningError } from '../errors';

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | JsonObject;

export type JsonObject = { readonly [key: string]: JsonValue };

function isPlainObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Keys that reassign an object's prototype chain rather than data. None are
 * legitimate Zed setting names, so encountering one is treated as malformed
 * input and rejected rather than merged.
 */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Deep-merge `overlay` onto `base`; `overlay` wins on every leaf it defines. */
export function deepMerge(base: JsonObject, overlay: JsonObject): JsonObject {
  const result: Record<string, JsonValue> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    if (UNSAFE_KEYS.has(key)) {
      throw new ProvisioningError(
        `Zed settings contain a disallowed key '${key}'.`,
      );
    }
    const existing = result[key];
    result[key] =
      isPlainObject(value) && existing !== undefined && isPlainObject(existing)
        ? deepMerge(existing, value)
        : value;
  }
  return result;
}

export interface NamedSettings {
  readonly name: string;
  readonly settings: JsonObject;
}

interface OwnedLeaf {
  readonly owner: string;
  readonly path: readonly string[];
}

// Owner paths are tracked as key arrays and only joined for display, so a
// literal dotted key ('a.b') and the nested path a -> b never alias into the
// same tracking entry and report a false conflict.
function pathKey(path: readonly string[]): string {
  return JSON.stringify(path);
}

function displayPath(path: readonly string[]): string {
  return path.join('.');
}

function isNestedUnder(
  ancestor: readonly string[],
  candidate: readonly string[],
): boolean {
  return (
    candidate.length > ancestor.length &&
    ancestor.every((segment, index) => candidate[index] === segment)
  );
}

/**
 * Deep-merge a set of named override fragments into one. Two overrides
 * setting the same leaf key is ambiguous — which one should win is not
 * derivable from the data — so it fails loudly with `ProvisioningError`
 * instead of letting catalog order silently decide.
 */
export function combineOverrides(
  overrides: readonly NamedSettings[],
): JsonObject {
  const owners = new Map<string, OwnedLeaf>();
  return overrides.reduce<JsonObject>(
    (combined, override) => mergeTracked(combined, override, owners, []),
    {},
  );
}

function mergeTracked(
  combined: JsonObject,
  override: NamedSettings,
  owners: Map<string, OwnedLeaf>,
  pathPrefix: readonly string[],
): JsonObject {
  const result: Record<string, JsonValue> = { ...combined };
  for (const [key, value] of Object.entries(override.settings)) {
    if (UNSAFE_KEYS.has(key)) {
      throw new ProvisioningError(
        `Zed override '${override.name}' sets a disallowed key '${key}'.`,
      );
    }
    const path = [...pathPrefix, key];
    const existing = result[key];
    if (
      isPlainObject(value) &&
      (existing === undefined || isPlainObject(existing))
    ) {
      result[key] = mergeTracked(
        existing === undefined ? {} : existing,
        { name: override.name, settings: value },
        owners,
        path,
      );
      continue;
    }
    // A prior override may have claimed a key nested under `path` (e.g.
    // 'agent.commit_message_model.model'); overwriting `path` itself with a
    // primitive here would silently discard that nested contribution.
    for (const claimed of owners.values()) {
      if (
        claimed.owner !== override.name &&
        isNestedUnder(path, claimed.path)
      ) {
        throw new ProvisioningError(
          `Zed overrides '${claimed.owner}' and '${override.name}' both set '${displayPath(path)}'.`,
        );
      }
    }
    const owned = owners.get(pathKey(path));
    if (owned !== undefined && owned.owner !== override.name) {
      throw new ProvisioningError(
        `Zed overrides '${owned.owner}' and '${override.name}' both set '${displayPath(path)}'.`,
      );
    }
    owners.set(pathKey(path), { owner: override.name, path });
    result[key] = value;
  }
  return result;
}
