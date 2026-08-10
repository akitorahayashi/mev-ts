import { errorMessage, ProvisioningError } from '../errors';

/**
 * Assertions over values decoded from `unknown` (parsed YAML/JSON). Every parser
 * narrows through these so the record predicate lives once and the rejection
 * messages share one shape, instead of each module re-improvising the checks.
 *
 * Each assertion takes the error class to raise, because the same checks serve
 * both provisioning parsers and the identity store, which reports `AppError`.
 * Without it a caller has to catch and re-wrap purely to change the class,
 * which is how message shapes drifted apart in the first place.
 */

export type ErrorFactory = (message: string) => Error;

const provisioningError: ErrorFactory = (message) =>
  new ProvisioningError(message);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function requireRecord(
  value: unknown,
  label: string,
  raise: ErrorFactory = provisioningError,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw raise(`${label} must be a mapping.`);
  }
  return value;
}

export function requireStringArray(
  value: unknown,
  label: string,
  raise: ErrorFactory = provisioningError,
): string[] {
  if (!Array.isArray(value)) {
    throw raise(`${label} must be a sequence.`);
  }
  if (!value.every((entry): entry is string => typeof entry === 'string')) {
    throw raise(`${label} must be a sequence of strings.`);
  }
  return value;
}

/** A present, non-blank string. Whitespace-only counts as absent. */
export function requireNonEmptyString(
  value: unknown,
  label: string,
  raise: ErrorFactory = provisioningError,
): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw raise(`${label} must be a non-empty string.`);
  }
  return value;
}

export function parseJsonLabeled(
  raw: string,
  label: string,
  raise: ErrorFactory = provisioningError,
): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw raise(`${label} is not valid JSON: ${errorMessage(error)}`);
  }
}

export function requireExactKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
  label: string,
  raise: ErrorFactory = provisioningError,
): void {
  const allowed = new Set(keys);
  const unknown = Object.keys(record).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw raise(
      `${label} contains unknown field '${unknown[0]}'. Expected only: ${keys.join(', ')}.`,
    );
  }
}

export function requireUniqueBy<T>(
  values: readonly T[],
  keyFor: (value: T) => string,
  label: string,
  raise: ErrorFactory = provisioningError,
): void {
  const seen = new Set<string>();
  for (const value of values) {
    const key = keyFor(value);
    if (seen.has(key)) {
      throw raise(`${label} contains duplicate '${key}'.`);
    }
    seen.add(key);
  }
}
