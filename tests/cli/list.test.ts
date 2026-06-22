import { expect, test } from 'bun:test';
import { formatTargetList } from '../../src/mev/cli/commands/list';
import { allTargets } from '../../src/mev/config/registry';

test('formatTargetList includes every registered target name', () => {
  const output = formatTargetList(false);
  for (const t of allTargets()) {
    expect(output).toContain(t.name);
  }
});

test('formatTargetList includes every target description', () => {
  const output = formatTargetList(false);
  for (const t of allTargets()) {
    expect(output).toContain(t.description);
  }
});

test('formatTargetList includes aliases when present', () => {
  const output = formatTargetList(false);
  for (const t of allTargets()) {
    for (const alias of t.aliases) {
      expect(output).toContain(alias);
    }
  }
});

test('formatTargetList includes column headers', () => {
  const output = formatTargetList(false);
  expect(output).toContain('TARGET');
  expect(output).toContain('TAGS');
  expect(output).toContain('DESCRIPTION');
});

test('formatTargetList contains no ANSI codes when isTTY is false', () => {
  const output = formatTargetList(false);
  expect(output).not.toContain('\x1b[');
});

test('formatTargetList contains ANSI codes when isTTY is true', () => {
  const output = formatTargetList(true);
  expect(output).toContain('\x1b[');
});
