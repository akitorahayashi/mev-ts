import type { IdentityView } from '../../app/identity';
import { makeStyle } from './style';

export function renderIdentities(
  view: IdentityView,
  isTTY = process.stdout.isTTY ?? false,
): string {
  const c = makeStyle(isTTY);

  const rows = (['personal', 'work'] as const).map((scope) => {
    const identity = view[scope];
    return {
      scope,
      name: identity?.name ?? 'Not configured',
      email: identity?.email ?? '',
      active: view.current.kind === 'matched' && view.current.scope === scope,
    };
  });

  const scopeWidth = Math.max(
    'PROFILE'.length,
    ...rows.map((r) => r.scope.length),
  );
  const nameWidth = Math.max('NAME'.length, ...rows.map((r) => r.name.length));
  const emailWidth = Math.max(
    'EMAIL'.length,
    ...rows.map((r) => r.email.length),
  );

  const pad = (s: string, width: number) =>
    s + ' '.repeat(width - s.length + 1);

  const header =
    ` ${c.bold(pad('PROFILE', scopeWidth))}` +
    `${c.bold(pad('NAME', nameWidth))}` +
    `${c.bold(pad('EMAIL', emailWidth))}` +
    `${c.bold('ACTIVE')}`;

  const sep =
    ` ${c.dim(pad('─'.repeat(scopeWidth), scopeWidth))}` +
    `${c.dim(pad('─'.repeat(nameWidth), nameWidth))}` +
    `${c.dim(pad('─'.repeat(emailWidth), emailWidth))}` +
    `${c.dim('─'.repeat('ACTIVE'.length))}`;

  const body = rows.map((r) => {
    const marker = r.active ? c.green('●') : '';
    return (
      ` ${c.cyan(pad(r.scope, scopeWidth))}` +
      `${pad(r.name, nameWidth)}` +
      `${pad(r.email, emailWidth)}` +
      `${marker}`
    );
  });

  return `\n Identity file  ${view.path}\n\n${header}\n${sep}\n${body.join('\n')}\n\n${renderCurrent(view, c)}\n`;
}

function renderCurrent(
  view: IdentityView,
  c: ReturnType<typeof makeStyle>,
): string {
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
