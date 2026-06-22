import type { CAC } from 'cac';
import { allFeatures } from '../../config/registry';

function ansi(code: string, s: string): string {
  return `\x1b[${code}m${s}\x1b[0m`;
}

function makeStyle(isTTY: boolean) {
  return {
    bold: (s: string) => (isTTY ? ansi('1', s) : s),
    dim: (s: string) => (isTTY ? ansi('2', s) : s),
    cyan: (s: string) => (isTTY ? ansi('96', s) : s),
    yellow: (s: string) => (isTTY ? ansi('33', s) : s),
  };
}

export function formatFeatureList(
  isTTY = process.stdout.isTTY ?? false,
): string {
  const features = allFeatures();
  const c = makeStyle(isTTY);

  const nameColWidth = Math.max(
    'FEATURE'.length,
    ...features.map((f) => f.name.length),
  );
  const tagColWidth = Math.max(
    'TAGS'.length,
    ...features.map((f) => [...f.tags, ...f.aliases].join(', ').length),
  );

  const pad = (s: string, width: number) =>
    s + ' '.repeat(width - s.length + 1);

  const header =
    ` ${c.bold(pad('FEATURE', nameColWidth))}` +
    `${c.bold(pad('TAGS', tagColWidth))}` +
    `${c.bold('DESCRIPTION')}`;

  const sep =
    ` ${c.dim(pad('─'.repeat(nameColWidth), nameColWidth))}` +
    `${c.dim(pad('─'.repeat(tagColWidth), tagColWidth))}` +
    `${c.dim('─'.repeat('DESCRIPTION'.length))}`;

  const rows = features.map((f) => {
    const tags = [...f.tags, ...f.aliases].join(', ');
    return (
      ' ' +
      c.cyan(pad(f.name, nameColWidth)) +
      c.yellow(pad(tags, tagColWidth)) +
      f.description
    );
  });

  return `\n${header}\n${sep}\n${rows.join('\n')}\n\n`;
}

export function registerListCommand(program: CAC): void {
  program
    .command('list', 'List available features.')
    .alias('ls')
    .action(() => {
      process.stdout.write(formatFeatureList());
    });
}
