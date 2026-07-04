import { join } from 'node:path';
import { ProvisioningError } from '../../errors';
import { readDirentsIfPresent, readTextIfPresent } from '../../host/absence';
import { loadYaml } from '../../host/yaml';

/**
 * The catalog of coder selectables. It is the authority for which entries exist
 * and, for sections, the order they concatenate in. Sections come from the
 * deployed `catalog.yml`; skills from scanning the deployed skills directory.
 * Both read the deployed sources, never the embedded assets, so selection and
 * provisioning agree on the same materialized tree.
 */

interface SectionsCatalogFile {
  readonly sections?: unknown;
}

/**
 * Validate a section catalog against the section files present beside it.
 *
 * `listed` is the declared concatenation order. A listed section without a
 * matching `<name>.md`, a `<name>.md` not listed, or a duplicate listing is an
 * error — no silent fallback masks a misconfigured catalog.
 */
export function reconcileSections(
  listed: readonly string[],
  presentStems: readonly string[],
): string[] {
  const seen = new Set<string>();
  for (const name of listed) {
    if (seen.has(name)) {
      throw new ProvisioningError(
        `Duplicate section '${name}' listed in catalog.yml.`,
      );
    }
    seen.add(name);
    if (!presentStems.includes(name)) {
      throw new ProvisioningError(
        `Section '${name}' is listed in catalog.yml but '${name}.md' is missing.`,
      );
    }
  }
  for (const stem of presentStems) {
    if (!listed.includes(stem)) {
      throw new ProvisioningError(
        `Section file '${stem}.md' exists but is not listed in catalog.yml.`,
      );
    }
  }
  return [...listed];
}

/** Read and validate the AGENTS.md section catalog from a deployed source dir. */
export async function readSections(sourceDir: string): Promise<string[]> {
  const catalogPath = join(sourceDir, 'catalog.yml');
  const raw = await readTextIfPresent(catalogPath);
  if (raw === null) {
    throw new ProvisioningError(
      `AGENTS.md section catalog not found: ${catalogPath}. Run provisioning to deploy it first.`,
    );
  }
  const parsed = loadYaml(raw) as SectionsCatalogFile;
  if (!Array.isArray(parsed?.sections)) {
    throw new ProvisioningError(
      `AGENTS.md section catalog must contain a sections sequence: ${catalogPath}.`,
    );
  }
  if (!parsed.sections.every((entry) => typeof entry === 'string')) {
    throw new ProvisioningError(
      `AGENTS.md section catalog must contain a sections sequence of strings: ${catalogPath}.`,
    );
  }
  const listed = parsed.sections;
  const entries = await readDirentsIfPresent(sourceDir);
  if (entries === null) {
    throw new ProvisioningError(
      `AGENTS.md section catalog not found: ${catalogPath}. Run provisioning to deploy it first.`,
    );
  }
  const presentStems = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name.slice(0, -'.md'.length));
  return reconcileSections(listed, presentStems);
}

/** Read the skills catalog by scanning the deployed skills source directory. */
export async function readSkills(sourceDir: string): Promise<string[]> {
  const entries = await readDirentsIfPresent(sourceDir);
  if (entries === null) {
    throw new ProvisioningError(
      `Skills source directory is missing: ${sourceDir}. Run provisioning to deploy it first.`,
    );
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}
