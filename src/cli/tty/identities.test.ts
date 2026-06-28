import { expect, test } from 'bun:test';
import type { IdentityView } from '../../app/identity';
import { renderIdentities } from './identities';

const baseView: IdentityView = {
  path: '/Users/test/.config/mev/identity.json',
  personal: { name: 'Personal Name', email: 'personal@example.com' },
  work: { name: 'Work Name', email: 'work@example.com' },
  current: { kind: 'unset' },
};

test('renderIdentities lists both profiles with column headers', () => {
  const output = renderIdentities(baseView, false);
  expect(output).toContain('PROFILE');
  expect(output).toContain('NAME');
  expect(output).toContain('EMAIL');
  expect(output).toContain('ACTIVE');
  expect(output).toContain('personal');
  expect(output).toContain('work@example.com');
});

test('renderIdentities shows the matched scope in the current footer', () => {
  const output = renderIdentities(
    {
      ...baseView,
      current: {
        kind: 'matched',
        scope: 'work',
        identity: { name: 'Work Name', email: 'work@example.com' },
      },
    },
    false,
  );
  expect(output).toContain('git --global  Work Name <work@example.com>');
  expect(output).toContain('→ work');
});

test('renderIdentities flags an unmanaged current identity', () => {
  const output = renderIdentities(
    {
      ...baseView,
      current: {
        kind: 'unmanaged',
        identity: { name: 'Stray', email: 'stray@example.com' },
      },
    },
    false,
  );
  expect(output).toContain('→ unmanaged');
});

test('renderIdentities labels missing profiles as Not configured', () => {
  const output = renderIdentities({ ...baseView, work: null }, false);
  expect(output).toContain('Not configured');
});

test('renderIdentities emits no ANSI codes when isTTY is false', () => {
  expect(renderIdentities(baseView, false)).not.toContain('\x1b[');
});

test('renderIdentities emits ANSI codes when isTTY is true', () => {
  expect(renderIdentities(baseView, true)).toContain('\x1b[');
});
