import { ProvisioningError } from '../../errors';

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

/** Deep-merge `overlay` onto `base`; `overlay` wins on every leaf it defines. */
export function deepMerge(base: JsonObject, overlay: JsonObject): JsonObject {
  const result: Record<string, JsonValue> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
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

/**
 * Deep-merge a set of named override fragments into one. Two overrides
 * setting the same leaf key is ambiguous — which one should win is not
 * derivable from the data — so it fails loudly with `ProvisioningError`
 * instead of letting catalog order silently decide.
 */
export function combineOverrides(
  overrides: readonly NamedSettings[],
): JsonObject {
  const owners = new Map<string, string>();
  return overrides.reduce<JsonObject>(
    (combined, override) => mergeTracked(combined, override, owners, ''),
    {},
  );
}

function mergeTracked(
  combined: JsonObject,
  override: NamedSettings,
  owners: Map<string, string>,
  pathPrefix: string,
): JsonObject {
  const result: Record<string, JsonValue> = { ...combined };
  for (const [key, value] of Object.entries(override.settings)) {
    const path = pathPrefix ? `${pathPrefix}.${key}` : key;
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
    const owner = owners.get(path);
    if (owner !== undefined && owner !== override.name) {
      throw new ProvisioningError(
        `Zed overrides '${owner}' and '${override.name}' both set '${path}'.`,
      );
    }
    owners.set(path, override.name);
    result[key] = value;
  }
  return result;
}
