import { ProvisioningError } from '../errors';

/**
 * Assertions over values decoded from `unknown` (parsed YAML/JSON). Every parser
 * narrows through these so the record predicate lives once and the rejection
 * messages share one shape, instead of each module re-improvising the checks.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Narrow `value` to a mapping or throw a labeled ProvisioningError. */
export function requireRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ProvisioningError(`${label} must be a mapping.`);
  }
  return value;
}

/** Narrow `value` to a sequence of strings or throw a labeled ProvisioningError. */
export function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new ProvisioningError(`${label} must be a sequence.`);
  }
  if (!value.every((entry): entry is string => typeof entry === 'string')) {
    throw new ProvisioningError(`${label} must be a sequence of strings.`);
  }
  return value;
}

export function requireExactKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const allowed = new Set(keys);
  const unknown = Object.keys(record).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new ProvisioningError(
      `${label} contains unknown field '${unknown[0]}'. Expected only: ${keys.join(', ')}.`,
    );
  }
}

export function requireUniqueBy<T>(
  values: readonly T[],
  keyFor: (value: T) => string,
  label: string,
): void {
  const seen = new Set<string>();
  for (const value of values) {
    const key = keyFor(value);
    if (seen.has(key)) {
      throw new ProvisioningError(`${label} contains duplicate '${key}'.`);
    }
    seen.add(key);
  }
}
