import { join } from 'node:path';
import { ProvisioningError } from '../../errors';
import { readTextIfPresent } from '../../host/absence';
import { writeFileAtomically } from '../../host/atomic-file';
import { combineOverrides, deepMerge, type JsonObject } from './merge';

async function readJson(path: string, label: string): Promise<JsonObject> {
  const raw = await readTextIfPresent(path);
  if (raw === null) {
    throw new ProvisioningError(
      `${label} not found: ${path}. Run provisioning to deploy it first.`,
    );
  }
  return JSON.parse(raw) as JsonObject;
}

/** Render the base settings merged with the enabled overrides, in catalog order. */
export async function renderSettings(
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
  const document = await renderSettings(basePath, sourceDir, enabled);
  const existing = await readTextIfPresent(outputPath);
  if (existing === document) {
    return false;
  }
  await writeFileAtomically(outputPath, document);
  return true;
}
