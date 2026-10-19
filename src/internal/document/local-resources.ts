import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { CssNode } from 'css-tree';
import generate from 'css-tree/generator';
import parseCss from 'css-tree/parser';
import walk from 'css-tree/walker';
import { type DefaultTreeAdapterMap, parse, serialize } from 'parse5';
import { errorMessage } from '../../errors';
import { DocumentConversionError } from './conversion-error';

type Element = DefaultTreeAdapterMap['element'];
type Node = DefaultTreeAdapterMap['node'];

function resourceUrl(reference: string, base: URL): URL {
  const url = new URL(reference, base);
  if (
    reference.trim().startsWith('//') ||
    (url.protocol !== 'file:' && url.protocol !== 'data:')
  ) {
    throw new DocumentConversionError(
      `Nonlocal document resource '${reference}' is not supported.`,
    );
  }
  return url;
}

async function localBytes(url: URL): Promise<Buffer> {
  const path = fileURLToPath(url);
  if (!(await stat(path)).isFile()) {
    throw new DocumentConversionError(
      `Document resource '${path}' must be a regular file.`,
    );
  }
  return readFile(path);
}

function encoded(bytes: Buffer | string, mime: string): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}

async function embedded(reference: string, base: URL): Promise<string> {
  if (!reference || reference.startsWith('#')) return reference;
  const url = resourceUrl(reference, base);
  if (url.protocol === 'data:') return reference;
  return (
    encoded(await localBytes(url), Bun.file(fileURLToPath(url)).type) + url.hash
  );
}

async function stylesheet(
  reference: string,
  base: URL,
  ancestors: ReadonlySet<string>,
): Promise<string> {
  const url = resourceUrl(reference, base);
  let source: string;
  let identity: string;
  if (url.protocol === 'data:') {
    const comma = url.href.indexOf(',');
    const header = url.href.slice(0, comma);
    if (comma < 0 || !/^data:text\/css(?:;|$)/i.test(header)) {
      throw new DocumentConversionError(
        'Imported data resources must be CSS stylesheets.',
      );
    }
    source = /;base64$/i.test(header)
      ? Buffer.from(url.href.slice(comma + 1), 'base64').toString('utf8')
      : decodeURIComponent(url.href.slice(comma + 1));
    identity = url.href;
  } else {
    identity = await realpath(fileURLToPath(url));
    source = (await localBytes(url)).toString('utf8');
  }
  if (ancestors.has(identity)) {
    throw new DocumentConversionError(
      `Cyclic stylesheet import '${reference}'.`,
    );
  }
  return resolveCss(
    source,
    url.protocol === 'data:' ? base : url,
    'stylesheet',
    new Set([...ancestors, identity]),
  );
}

async function resolveCss(
  source: string,
  base: URL,
  context: 'stylesheet' | 'declarationList',
  ancestors: ReadonlySet<string> = new Set(),
): Promise<string> {
  const ast = parseCss(source, {
    context,
    parseCustomProperty: true,
    onParseError(error) {
      throw error;
    },
  });
  const resources: { node: CssNode & { value: string }; imported: boolean }[] =
    [];
  walk(ast, function (node) {
    if (node.type === 'Raw') {
      throw new DocumentConversionError(
        'Unparsed CSS cannot establish local-only resource ownership.',
      );
    }
    const imported = this.atrule?.name.toLowerCase() === 'import';
    if (
      node.type === 'Url' ||
      (node.type === 'String' &&
        (imported ||
          this.function?.name.toLowerCase() === 'image-set' ||
          this.function?.name.toLowerCase() === '-webkit-image-set'))
    ) {
      resources.push({ node, imported });
    }
  });
  for (const { node, imported } of resources) {
    node.value = imported
      ? encoded(await stylesheet(node.value, base, ancestors), 'text/css')
      : await embedded(node.value, base);
  }
  return generate(ast);
}

function attribute(element: Element, name: string): string | undefined {
  return element.attrs.find((attr) => attr.name === name)?.value;
}

async function resolveElement(element: Element, base: URL): Promise<void> {
  const tag = element.tagName;
  if (
    tag === 'base' ||
    (tag === 'meta' &&
      attribute(element, 'http-equiv')?.toLowerCase() === 'refresh')
  ) {
    throw new DocumentConversionError(
      'Document resource base overrides and refreshes are not supported.',
    );
  }
  if (attribute(element, 'srcset')) {
    throw new DocumentConversionError(
      'Document srcset resources are not supported; a single local src is required.',
    );
  }
  for (const attr of element.attrs) {
    if (attr.name === 'style') {
      attr.value = await resolveCss(attr.value, base, 'declarationList');
    } else if (tag === 'link' && attr.name === 'href') {
      if (
        attribute(element, 'rel')
          ?.toLowerCase()
          .split(/\s+/)
          .includes('stylesheet')
      ) {
        attr.value = encoded(
          await stylesheet(attr.value, base, new Set()),
          'text/css',
        );
      } else {
        attr.value = await embedded(attr.value, base);
      }
    } else if (
      attr.name === 'src' ||
      attr.name === 'poster' ||
      (tag === 'object' && attr.name === 'data')
    ) {
      // Markdown's remote images remain external; browser routing owns blocking them.
      if (
        tag === 'img' &&
        (attr.value.trim().startsWith('//') ||
          /^https?:$/.test(new URL(attr.value, base).protocol))
      )
        continue;
      attr.value = await embedded(attr.value, base);
    }
  }
  if (tag === 'style') {
    const source = element.childNodes
      .map((node) => ('value' in node ? node.value : ''))
      .join('');
    element.childNodes = [
      {
        nodeName: '#text',
        value: await resolveCss(source, base, 'stylesheet'),
        parentNode: element,
      },
    ];
  }
}

async function resolveTree(node: Node, base: URL): Promise<void> {
  if ('tagName' in node) await resolveElement(node, base);
  if ('childNodes' in node) {
    for (const child of node.childNodes) await resolveTree(child, base);
  }
}

export async function embedLocalResources(
  html: string,
  input: string,
): Promise<string> {
  try {
    const document = parse(html);
    await resolveTree(document, pathToFileURL(input));
    return serialize(document);
  } catch (error) {
    if (error instanceof DocumentConversionError) throw error;
    throw new DocumentConversionError(
      `Unable to resolve local resources for '${dirname(input)}': ${errorMessage(error)}`,
    );
  }
}
