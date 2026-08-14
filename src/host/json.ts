import { ProvisioningError } from '../errors';
import { isRecord, parseJsonLabeled } from './parse';

/**
 * Parse a JSON document that must be an object at the top level, labeled by
 * `source` (mirroring `loadToml`). Owned here so every JSON-object rejection in
 * provisioning shares one message shape.
 */
export function loadJsonObject(
  raw: string,
  source: string,
): Record<string, unknown> {
  const value = parseJsonLabeled(raw, source);
  if (!isRecord(value)) {
    throw new ProvisioningError(
      `${source} must be a JSON object, not an array or primitive.`,
    );
  }
  return value;
}

/** The repository's one on-disk JSON shape: 2-space indent, trailing newline. */
export function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
