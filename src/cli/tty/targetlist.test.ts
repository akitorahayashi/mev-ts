import { expect, test } from 'bun:test';
import { renderTargetList } from './targetlist';

// A fixed, independent smoke subset of known targets. Hardcoding these (rather
// than iterating the same registry the renderer consumes) keeps the oracle
// independent of the implementation under test: a regression that drops a
// well-known target from the listing now fails here.
const KNOWN = [
  { name: 'git', alias: undefined, description: 'Git configuration' },
  { name: 'shell', alias: 'sh', description: 'Shell environment' },
  { name: 'coder', alias: 'cdr', description: 'AI coding agents' },
  { name: 'bun', alias: 'b', description: 'Bun JavaScript runtime' },
  { name: 'python', alias: 'py', description: 'Python via uv' },
];

test('renderTargetList lists known target names', () => {
  const output = renderTargetList(false);
  for (const target of KNOWN) {
    expect(output).toContain(target.name);
  }
});

test('renderTargetList lists known target aliases', () => {
  const output = renderTargetList(false);
  for (const target of KNOWN) {
    if (target.alias) expect(output).toContain(target.alias);
  }
});

test('renderTargetList lists known target descriptions', () => {
  const output = renderTargetList(false);
  for (const target of KNOWN) {
    expect(output).toContain(target.description);
  }
});

test('renderTargetList includes column headers', () => {
  const output = renderTargetList(false);
  expect(output).toContain('TARGET');
  expect(output).toContain('SELECTORS');
  expect(output).toContain('DESCRIPTION');
});

test('renderTargetList contains no ANSI codes when isTTY is false', () => {
  const output = renderTargetList(false);
  expect(output).not.toContain('\x1b[');
});

test('renderTargetList contains ANSI codes when isTTY is true', () => {
  const output = renderTargetList(true);
  expect(output).toContain('\x1b[');
});
