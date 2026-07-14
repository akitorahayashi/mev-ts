import type { IdentityView } from '../../app/identity';
import { allScopes } from '../../identity/scope';
import { makeStyle, type Style } from './style';
import { renderTable } from './table';

export function renderIdentities(view: IdentityView, isTTY: boolean): string {
  const c = makeStyle(isTTY);

  const rows = allScopes().map((scope) => {
    const identity = view.identities[scope];
    const active =
      view.current.kind === 'matched' && view.current.scope === scope;
    return [
      scope,
      identity?.name ?? 'Not configured',
      identity?.email ?? '',
      active ? c.green('●') : '',
    ];
  });

  const table = renderTable(
    c,
    [
      { header: 'PROFILE', style: c.cyan },
      { header: 'NAME' },
      { header: 'EMAIL' },
      { header: 'ACTIVE' },
    ],
    rows,
  );

  return `\n Identity file  ${view.path}\n\n${table}\n\n${renderCurrent(view, c)}\n`;
}

function renderCurrent(view: IdentityView, c: Style): string {
  const current = view.current;
  if (current.kind === 'unset') {
    return ` git --global  ${c.dim('not set')}`;
  }
  const who = `${current.identity.name} <${current.identity.email}>`;
  if (current.kind === 'matched') {
    return ` git --global  ${who}  ${c.green(`→ ${current.scope}`)}`;
  }
  return ` git --global  ${who}  ${c.yellow('→ unmanaged')}`;
}
