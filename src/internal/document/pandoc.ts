import { writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { type CommandRunner, formatCommandFailure } from '../../host/command';
import { DocumentConversionError } from './conversion-error';
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
  readonly remoteResourcePolicy: string;
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

const remoteResourcePolicy = `local remote_url_pattern = "^[Hh][Tt][Tt][Pp][Ss]?://"

local function is_remote_url(value)
  return value ~= nil and value:match(remote_url_pattern) ~= nil
end

function Image(image)
  if is_remote_url(image.src) then
    image.attributes["data-external"] = "1"
  end
  return image
end

local resource_tags = {
  img = true,
  script = true,
  source = true,
  video = true,
  audio = true,
  iframe = true,
  embed = true,
  object = true,
  link = true,
}

local resource_attributes = { "src", "href", "poster", "data" }

local function has_remote_resource_attribute(tag)
  local lower_tag = tag:lower()
  for _, attribute in ipairs(resource_attributes) do
    if lower_tag:match("%s" .. attribute .. "%s*=%s*['\\"]?https?://") then
      return true
    end
  end
  return false
end

local function reject_remote_html_resources(text)
  for tag in text:gmatch("<[^>]+>") do
    local name = tag:match("^%s*<%s*/?%s*([%w:-]+)")
    if name ~= nil and resource_tags[name:lower()] and has_remote_resource_attribute(tag) then
      error("Remote HTML resources are not supported in Markdown-to-PDF input")
    end
  end
end

function RawInline(raw)
  if raw.format:match("html") then
    reject_remote_html_resources(raw.text)
  end
  return raw
end

function RawBlock(raw)
  if raw.format:match("html") then
    reject_remote_html_resources(raw.text)
  end
  return raw
end
`;

export async function preparePandocAssets(
  workspace: string,
  customStylesheet: string | undefined,
  margins: PageMargins,
): Promise<PandocAssets> {
  const template = join(workspace, 'template.html');
  const baseStylesheet = join(workspace, 'print.css');
  const policy = join(workspace, 'remote-resource-policy.lua');
  await Promise.all([
    writeFile(template, htmlTemplate),
    writeFile(baseStylesheet, printStyles),
    writeFile(policy, remoteResourcePolicy),
  ]);

  const stylesheets = [baseStylesheet];
  if (customStylesheet) stylesheets.push(resolve(customStylesheet));
  const overrides = marginStyles(margins);
  if (overrides) {
    const overrideStylesheet = join(workspace, 'page-overrides.css');
    await writeFile(overrideStylesheet, overrides);
    stylesheets.push(overrideStylesheet);
  }
  return { remoteResourcePolicy: policy, template, stylesheets };
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
    `--lua-filter=${assets.remoteResourcePolicy}`,
    '--embed-resources',
    `--resource-path=${dirname(input)}`,
    `--metadata=title:${basename(input)}`,
    ...assets.stylesheets.map((path) => `--css=${path}`),
    input,
  ];
  const result = await run.run('pandoc', args, { cwd: dirname(input) });
  if (result.code !== 0) {
    throw new DocumentConversionError(
      formatCommandFailure(`Failed to render '${input}'`, result),
    );
  }
  return {
    html: result.stdout,
    warning: result.stderr.trim() || undefined,
  };
}
