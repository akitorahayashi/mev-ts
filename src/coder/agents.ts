import { join } from 'node:path';
import { writeFileIfChanged } from '../host/atomic-file';
import { readDeployedText } from '../host/deployed-file';

const TITLE = '# Rules';

async function renderAgents(
  sourceDir: string,
  enabled: readonly string[],
): Promise<string> {
  let document = `${TITLE}\n\n`;
  for (const name of enabled) {
    const path = join(sourceDir, `${name}.md`);
    const body = await readDeployedText(path, `AGENTS.md section '${name}'`);
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
  return writeFileIfChanged(outputPath, await renderAgents(sourceDir, enabled));
}
