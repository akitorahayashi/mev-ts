import { expect, test } from 'bun:test';
import { allTargets } from '../../provisioning/registry';
import { renderTargetList } from './targetlist';

// The registry is a separately owned authority the renderer consumes, so the
// expectation is derived from it rather than restating production wording here,
// where every catalog edit would break a renderer test.
test('renderTargetList lists every registered target with its selectors', () => {
  const output = renderTargetList(false);

  for (const target of allTargets()) {
    expect(output).toContain(target.name);
    expect(output).toContain(target.description);
    for (const alias of target.aliases) {
      expect(output).toContain(alias);
    }
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
