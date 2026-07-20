import { allTargets } from '../../provisioning/registry';
import { makeStyle } from './style';
import { renderTable } from './table';

export function renderTargetList(isTTY: boolean): string {
  const c = makeStyle(isTTY);
  const rows = allTargets().map((t) => [
    t.name,
    [t.name, ...t.aliases].join(', '),
    t.description,
  ]);
  const table = renderTable(
    c,
    [
      { header: 'TARGET', style: c.cyan },
      { header: 'SELECTORS', style: c.yellow },
      { header: 'DESCRIPTION' },
    ],
    rows,
  );
  return `\n${table}\n\n`;
}
