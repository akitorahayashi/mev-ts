import { expect, test } from 'bun:test';
import { formatFeatureList } from '../../src/mev/cli/commands/list';
import { allFeatures } from '../../src/mev/config/registry';

test('formatFeatureList includes every registered feature name', () => {
  const output = formatFeatureList(false);
  for (const feature of allFeatures()) {
    expect(output).toContain(feature.name);
  }
});

test('formatFeatureList includes every feature description', () => {
  const output = formatFeatureList(false);
  for (const feature of allFeatures()) {
    expect(output).toContain(feature.description);
  }
});

test('formatFeatureList includes aliases when present', () => {
  const output = formatFeatureList(false);
  for (const feature of allFeatures()) {
    for (const alias of feature.aliases) {
      expect(output).toContain(alias);
    }
  }
});

test('formatFeatureList includes column headers', () => {
  const output = formatFeatureList(false);
  expect(output).toContain('FEATURE');
  expect(output).toContain('TAGS');
  expect(output).toContain('DESCRIPTION');
});

test('formatFeatureList contains no ANSI codes when isTTY is false', () => {
  const output = formatFeatureList(false);
  expect(output).not.toContain('\x1b[');
});

test('formatFeatureList contains ANSI codes when isTTY is true', () => {
  const output = formatFeatureList(true);
  expect(output).toContain('\x1b[');
});
