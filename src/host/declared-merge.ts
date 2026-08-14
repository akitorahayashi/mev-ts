import { ProvisioningError } from '../errors';
import { isRecord } from './parse';

/**
 * Merge semantics for config files whose ownership is inverted relative to the
 * linked assets: the application rewrites the file wholesale at runtime
 * (registrations, enablement, app-managed tables), so mev cannot own the file.
 * It owns only the keys the embedded asset declares: declared mappings merge per
 * key recursively with declared values winning, declared scalars and arrays
 * replace, and host-only keys pass through untouched.
 */

/** A mapping, excluding dates (objects at runtime, but scalar TOML values). */
function isMapping(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && !(value instanceof Date);
}

/**
 * Keys that reassign an object's prototype chain rather than data. No supported
 * config file names one legitimately, so encountering one in a declared document
 * is malformed input and is rejected rather than merged.
 */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Exported so every merger rejects the same key list with its own message; a
 * second copy of the list would let a future addition protect one merger and
 * silently skip the other.
 */
export function isUnsafeKey(key: string): boolean {
  return UNSAFE_KEYS.has(key);
}

export function mergeDeclared(
  host: Record<string, unknown>,
  declared: Record<string, unknown>,
  label: string,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...host };
  for (const [key, value] of Object.entries(declared)) {
    if (UNSAFE_KEYS.has(key)) {
      throw new ProvisioningError(
        `${label} contains a disallowed key '${key}'.`,
      );
    }
    const current = merged[key];
    merged[key] =
      isMapping(value) && isMapping(current)
        ? mergeDeclared(current, value, label)
        : value;
  }
  return merged;
}

/**
 * Structural equality over parsed documents, so an unchanged check reacts to
 * value divergence only — never to the application reserializing the file with
 * different key order or formatting.
 */
export function valueEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left instanceof Date || right instanceof Date) {
    return (
      left instanceof Date &&
      right instanceof Date &&
      left.getTime() === right.getTime()
    );
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((entry, index) => valueEqual(entry, right[index]))
    );
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left);
    return (
      leftKeys.length === Object.keys(right).length &&
      leftKeys.every((key) => key in right && valueEqual(left[key], right[key]))
    );
  }
  return false;
}
