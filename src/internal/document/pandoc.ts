import { writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type { CommandRunner } from '../../host/command';
import { runProcessStep } from '../../host/command-run';
import { documentConversionError } from './conversion-error';
import { embedLocalResources } from './local-resources';
import printStyles from './print.css' with { type: 'text' };
import { htmlTemplate } from './template';

export interface PageMargins {
  readonly top?: string;
  readonly right?: string;
  readonly bottom?: string;
  readonly left?: string;
}

export interface PandocAssets {
  readonly template: string;
  readonly stylesheets: readonly string[];
}

export interface RenderedHtml {
  readonly html: string;
  readonly warning?: string;
}

function marginStyles(margins: PageMargins): string {
  const declarations = Object.entries(margins)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([side, value]) => `  margin-${side}: ${value};`);
  return declarations.length === 0
    ? ''
    : `@page {\n${declarations.join('\n')}\n}\n`;
}

export async function preparePandocAssets(
  workspace: string,
  customStylesheet: string | undefined,
  margins: PageMargins,
): Promise<PandocAssets> {
  const template = join(workspace, 'template.html');
  const baseStylesheet = join(workspace, 'print.css');
  await Promise.all([
    writeFile(template, htmlTemplate),
    writeFile(baseStylesheet, printStyles),
  ]);

  const stylesheets = [baseStylesheet];
  if (customStylesheet) stylesheets.push(resolve(customStylesheet));
  const overrides = marginStyles(margins);
  if (overrides) {
    const overrideStylesheet = join(workspace, 'page-overrides.css');
    await writeFile(overrideStylesheet, overrides);
    stylesheets.push(overrideStylesheet);
  }
  return { template, stylesheets };
}

export async function renderMarkdownHtml(
  run: CommandRunner,
  input: string,
  assets: PandocAssets,
): Promise<RenderedHtml> {
  const args = [
    '--from=gfm-raw_html',
    '--to=html5',
    '--standalone',
    `--template=${assets.template}`,
    '--syntax-highlighting=pygments',
    '--mathml',
    `--resource-path=${dirname(input)}`,
    `--metadata=title:${basename(input)}`,
    ...assets.stylesheets.map((path) => `--css=${path}`),
    input,
  ];
  const result = await runProcessStep(
    run,
    'pandoc',
    args,
    `Failed to render '${input}'`,
    { cwd: dirname(input), raise: documentConversionError },
  );
  return {
    html: await embedLocalResources(result.stdout, input),
    warning: result.stderr.trim() || undefined,
  };
}
