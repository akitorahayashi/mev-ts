import { join } from 'node:path';
import { ProvisioningError } from '../errors';
import { writeFileIfChanged } from '../host/atomic-file';
import { readDeployedText } from '../host/deployed-file';
import { isRecord, parseJsonLabeled } from '../host/parse';
import { combineOverrides, deepMerge, type JsonObject } from './merge';

// JSON.parse only yields JsonValues, so a top-level object is deeply a
// JsonObject; the shallow record check is therefore a sound narrowing.
function isJsonObject(value: unknown): value is JsonObject {
  return isRecord(value);
}

export function parseJsonObject(
  raw: string,
  path: string,
  label: string,
): JsonObject {
  const value = parseJsonLabeled(raw, `${label} at ${path}`);
  if (!isJsonObject(value)) {
    throw new ProvisioningError(
      `${label} at ${path} must be a JSON object, not an array or primitive.`,
    );
  }
  return value;
}

async function readJson(path: string, label: string): Promise<JsonObject> {
  const raw = await readDeployedText(path, label);
  return parseJsonObject(raw, path, label);
}

async function renderSettings(
  basePath: string,
  sourceDir: string,
  enabled: readonly string[],
): Promise<string> {
  const base = await readJson(basePath, 'Zed base settings');
  const overrides = await Promise.all(
    enabled.map(async (name) => ({
      name,
      settings: await readJson(
        join(sourceDir, `${name}.json`),
        `Zed override '${name}'`,
      ),
    })),
  );
  const merged = deepMerge(base, combineOverrides(overrides));
  return `${JSON.stringify(merged, null, 2)}\n`;
}

/**
 * Build the intermediate settings.json at `outputPath`, returning whether the
 * content changed. An unchanged file is left untouched so the activation can
 * report `unchanged` accurately.
 */
export async function buildSettings(
  basePath: string,
  sourceDir: string,
  enabled: readonly string[],
  outputPath: string,
): Promise<boolean> {
  return writeFileIfChanged(
    outputPath,
    await renderSettings(basePath, sourceDir, enabled),
  );
}
