import { expect, test } from 'bun:test';
import { parseUpgradeEnvelope } from './upgrade';

function entry(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    environment: 'yt-dlp',
    package: 'yt-dlp',
    previous_version: '1.0',
    version: '2.0',
    status: 'upgraded',
    injected: false,
    location: '/venvs/yt-dlp',
    interpreter: null,
    backend: 'pip',
    ...overrides,
  };
}

function envelope(packages: readonly unknown[]): string {
  return JSON.stringify({
    pipx_result_version: '0.1',
    command: ['upgrade'],
    status: 'success',
    exit_code: 0,
    data: { packages, skipped: [] },
    errors: [],
  });
}

test('an upgraded main package reports both versions', () => {
  const report = parseUpgradeEnvelope(envelope([entry()]), 'yt-dlp');
  expect(report.status).toBe('upgraded');
  expect(report.previousVersion).toBe('1.0');
  expect(report.version).toBe('2.0');
  expect(report.injectedUpgraded).toEqual([]);
});

test('an unchanged main package reports unchanged', () => {
  const report = parseUpgradeEnvelope(
    envelope([entry({ status: 'unchanged', version: '1.0' })]),
    'yt-dlp',
  );
  expect(report.status).toBe('unchanged');
});

test('only upgraded injected dependencies are collected', () => {
  const report = parseUpgradeEnvelope(
    envelope([
      entry({ status: 'unchanged', version: '1.0' }),
      entry({ package: 'driver-a', injected: true }),
      entry({ package: 'driver-b', injected: true, status: 'unchanged' }),
    ]),
    'yt-dlp',
  );
  expect(report.injectedUpgraded).toEqual(['driver-a']);
});

test('the main package match is normalization-aware', () => {
  const report = parseUpgradeEnvelope(
    envelope([entry({ package: 'Demo.Tool' })]),
    'demo-tool',
  );
  expect(report.status).toBe('upgraded');
});

test('a missing main entry fails loudly', () => {
  expect(() =>
    parseUpgradeEnvelope(envelope([entry({ injected: true })]), 'yt-dlp'),
  ).toThrow('no result');
});

test('a pinned status fails loudly', () => {
  expect(() =>
    parseUpgradeEnvelope(envelope([entry({ status: 'pinned' })]), 'yt-dlp'),
  ).toThrow("unsupported status 'pinned'");
});

test('invalid JSON fails loudly', () => {
  expect(() => parseUpgradeEnvelope('not json', 'yt-dlp')).toThrow('as JSON');
});

test('a malformed package entry fails loudly', () => {
  const broken = entry();
  delete broken['previous_version'];
  expect(() => parseUpgradeEnvelope(envelope([broken]), 'yt-dlp')).toThrow(
    'package entry',
  );
});
