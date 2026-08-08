import { expect, test } from 'bun:test';
import type { Installed } from './inventory';
import {
  installSpec,
  needsReinstall,
  shouldPostInstall,
  shouldUpgrade,
} from './reconciliation';

const installed: Installed = {
  name: 'yt-dlp',
  version: '1.0',
  dependencies: [],
};

test('installSpec resolves latest to the bare package name', () => {
  expect(installSpec({ package: 'yt-dlp', version: 'latest' })).toBe('yt-dlp');
});

test('installSpec pins with the == operator', () => {
  expect(installSpec({ package: 'yt-dlp', version: '2.0' })).toBe(
    'yt-dlp==2.0',
  );
});

test('needsReinstall ignores the installed version of a latest tool', () => {
  expect(
    needsReinstall({ package: 'yt-dlp', version: 'latest' }, installed),
  ).toBe(false);
  expect(
    needsReinstall({ package: 'yt-dlp', version: 'latest' }, undefined),
  ).toBe(true);
});

test('needsReinstall follows a pin that diverges from the installed version', () => {
  expect(needsReinstall({ package: 'yt-dlp', version: '1.0' }, installed)).toBe(
    false,
  );
  expect(needsReinstall({ package: 'yt-dlp', version: '2.0' }, installed)).toBe(
    true,
  );
});

test('shouldUpgrade requires upgrade mode', () => {
  const tool = { package: 'yt-dlp', version: 'latest' };
  expect(shouldUpgrade(tool, installed, false)).toBe(false);
  expect(shouldUpgrade(tool, installed, true)).toBe(true);
});

test('shouldUpgrade skips tools that are not installed', () => {
  expect(
    shouldUpgrade({ package: 'yt-dlp', version: 'latest' }, undefined, true),
  ).toBe(false);
});

test('shouldUpgrade never touches a version-pinned tool', () => {
  expect(
    shouldUpgrade({ package: 'yt-dlp', version: '1.0' }, installed, true),
  ).toBe(false);
  expect(
    shouldUpgrade({ package: 'yt-dlp', version: '2.0' }, installed, true),
  ).toBe(false);
});

test('shouldPostInstall runs after an upgrade only when declared', () => {
  const post = { bin: 'tool' };
  const tool = { package: 'x', version: 'latest', post_install: post };
  expect(shouldPostInstall(tool, false, false, true)).toBe(true);
  expect(shouldPostInstall(tool, false, false, false)).toBe(false);
  expect(
    shouldPostInstall({ package: 'x', version: 'latest' }, false, false, true),
  ).toBe(false);
});
