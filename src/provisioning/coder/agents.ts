import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

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
    const body = await readFile(join(sourceDir, `${name}.md`), 'utf8');
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
  const existing = await readFile(outputPath, 'utf8').catch(() => null);
  if (existing === document) {
    return false;
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, document);
  return true;
}
