import { expect, test } from 'bun:test';
import { renderTargetList } from '../../src/mev/cli/tty/targetlist';
import { allTargets } from '../../src/mev/config/registry';

test('renderTargetList includes every registered target name', () => {
  const output = renderTargetList(false);
  for (const t of allTargets()) {
    expect(output).toContain(t.name);
  }
});

test('renderTargetList includes every target description', () => {
  const output = renderTargetList(false);
  for (const t of allTargets()) {
    expect(output).toContain(t.description);
  }
});

test('renderTargetList includes aliases when present', () => {
  const output = renderTargetList(false);
  for (const t of allTargets()) {
    for (const alias of t.aliases) {
      expect(output).toContain(alias);
    }
  }
});

test('renderTargetList includes column headers', () => {
  const output = renderTargetList(false);
  expect(output).toContain('TARGET');
  expect(output).toContain('TAGS');
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
