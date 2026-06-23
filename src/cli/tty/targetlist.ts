import { allTargets } from '../../config/registry';
import { makeStyle } from './style';

export function renderTargetList(
  isTTY = process.stdout.isTTY ?? false,
): string {
  const targets = allTargets();
  const c = makeStyle(isTTY);

  const nameColWidth = Math.max(
    'TARGET'.length,
    ...targets.map((t) => t.name.length),
  );
  const tagColWidth = Math.max(
    'TAGS'.length,
    ...targets.map((t) => [...t.tags, ...t.aliases].join(', ').length),
  );

  const pad = (s: string, width: number) =>
    s + ' '.repeat(width - s.length + 1);

  const header =
    ` ${c.bold(pad('TARGET', nameColWidth))}` +
    `${c.bold(pad('TAGS', tagColWidth))}` +
    `${c.bold('DESCRIPTION')}`;

  const sep =
    ` ${c.dim(pad('─'.repeat(nameColWidth), nameColWidth))}` +
    `${c.dim(pad('─'.repeat(tagColWidth), tagColWidth))}` +
    `${c.dim('─'.repeat('DESCRIPTION'.length))}`;

  const rows = targets.map((t) => {
    const tags = [...t.tags, ...t.aliases].join(', ');
    return (
      ' ' +
      c.cyan(pad(t.name, nameColWidth)) +
      c.yellow(pad(tags, tagColWidth)) +
      t.description
    );
  });

  return `\n${header}\n${sep}\n${rows.join('\n')}\n\n`;
}
