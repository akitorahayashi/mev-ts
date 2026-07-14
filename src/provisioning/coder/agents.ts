import { join } from 'node:path';
import { ProvisioningError } from '../../errors';
import { readTextIfPresent } from '../../host/absence';
import { writeFileAtomically } from '../../host/atomic-file';

/** Title that precedes the concatenated sections. */
const TITLE = '# Rules';

/**
 * Concatenate the enabled sections, in catalog order, into a single document.
 * Each `<name>.md` body is taken verbatim (headings included), trailing
 * whitespace trimmed, and joined by a blank line under the title.
 */
export async function renderAgents(
  sourceDir: string,
  enabled: readonly string[],
): Promise<string> {
  let document = `${TITLE}\n\n`;
  for (const name of enabled) {
    const path = join(sourceDir, `${name}.md`);
    const body = await readTextIfPresent(path);
    if (body === null) {
      throw new ProvisioningError(
        `AGENTS.md section '${name}' not found: ${path}. Run provisioning to deploy it first.`,
      );
    }
    document += `${body.trimEnd()}\n\n`;
  }
  return document;
}

/**
 * Build the intermediate AGENTS.md at `outputPath`, returning whether the file
 * content changed. An unchanged file is left untouched so the activation can
 * report `unchanged` accurately.
 */
export async function buildAgents(
  sourceDir: string,
  enabled: readonly string[],
  outputPath: string,
): Promise<boolean> {
  const document = await renderAgents(sourceDir, enabled);
  const existing = await readTextIfPresent(outputPath);
  if (existing === document) {
    return false;
  }
  await writeFileAtomically(outputPath, document);
  return true;
}
