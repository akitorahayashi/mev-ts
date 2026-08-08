import { expect, test } from 'bun:test';
import type { Installed } from './inventory';
import { shouldPostInstall, shouldUpgrade } from './reconciliation';

const installed: Installed = {
  packageOrUrl: 'yt-dlp',
  version: '1.0',
  dependencies: [],
};

test('shouldUpgrade requires update mode', () => {
  expect(shouldUpgrade({ package: 'yt-dlp' }, installed, false)).toBe(false);
  expect(shouldUpgrade({ package: 'yt-dlp' }, installed, true)).toBe(true);
});

test('shouldUpgrade skips tools that are not installed', () => {
  expect(shouldUpgrade({ package: 'yt-dlp' }, undefined, true)).toBe(false);
});

test('shouldUpgrade never touches a version-pinned tool', () => {
  expect(
    shouldUpgrade({ package: 'yt-dlp', version: '1.0' }, installed, true),
  ).toBe(false);
});

test('shouldUpgrade defers to reinstall when the pin or spec diverges', () => {
  expect(
    shouldUpgrade({ package: 'yt-dlp', version: '2.0' }, installed, true),
  ).toBe(false);
  expect(
    shouldUpgrade(
      { package: 'yt-dlp', install_spec: 'git+https://example.com/x.git' },
      installed,
      true,
    ),
  ).toBe(false);
});

test('shouldUpgrade treats a matching unpinned install_spec as latest-assumed', () => {
  const spec = 'git+https://example.com/x.git';
  expect(
    shouldUpgrade(
      { package: 'yt-dlp', install_spec: spec },
      { ...installed, packageOrUrl: spec },
      true,
    ),
  ).toBe(true);
});

test('shouldPostInstall runs after an upgrade only when declared', () => {
  const post = { bin: 'tool' };
  expect(
    shouldPostInstall({ package: 'x', post_install: post }, false, false, true),
  ).toBe(true);
  expect(
    shouldPostInstall(
      { package: 'x', post_install: post },
      false,
      false,
      false,
    ),
  ).toBe(false);
  expect(shouldPostInstall({ package: 'x' }, false, false, true)).toBe(false);
});
