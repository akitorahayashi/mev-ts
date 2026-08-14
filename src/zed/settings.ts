import { join } from 'node:path';
import { writeFileIfChanged } from '../host/atomic-file';
import { readDeployedText } from '../host/deployed-file';
import { loadJsonObject, serializeJson } from '../host/json';
import { combineOverrides, deepMerge, type JsonObject } from './merge';

export function parseJsonObject(
  raw: string,
  path: string,
  label: string,
): JsonObject {
  // JSON.parse only yields JsonValues, so the record loadJsonObject returns is
  // deeply a JsonObject; the assertion is a sound narrowing, not a coercion.
  return loadJsonObject(raw, `${label} at ${path}`) as JsonObject;
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
  return serializeJson(merged);
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
