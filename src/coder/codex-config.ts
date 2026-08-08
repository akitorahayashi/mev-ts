import { isRecord } from '../host/parse';

/**
 * Merge semantics for the codex config file, whose ownership is inverted
 * relative to other managed configs: `~/.codex/config.toml` is a mutable file
 * that codex rewrites wholesale at runtime (plugin and marketplace
 * registrations, app-managed MCP servers, timestamps), so mev cannot own the
 * file. It owns only the keys the embedded asset declares: declared tables
 * merge per key recursively with declared values winning, declared scalars and
 * arrays replace, and host-only keys pass through untouched.
 */

/** A TOML table, excluding dates (objects at runtime, but scalar values). */
function isTable(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && !(value instanceof Date);
}

export function mergeDeclared(
  host: Record<string, unknown>,
  declared: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...host };
  for (const [key, value] of Object.entries(declared)) {
    const current = merged[key];
    merged[key] =
      isTable(value) && isTable(current)
        ? mergeDeclared(current, value)
        : value;
  }
  return merged;
}

/**
 * Structural equality over parsed TOML values, so the unchanged check reacts
 * to value divergence only — never to codex reserializing the file with
 * different key order or formatting.
 */
export function tomlValueEqual(left: unknown, right: unknown): boolean {
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
      left.every((entry, index) => tomlValueEqual(entry, right[index]))
    );
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left);
    return (
      leftKeys.length === Object.keys(right).length &&
      leftKeys.every(
        (key) => key in right && tomlValueEqual(left[key], right[key]),
      )
    );
  }
  return false;
}
