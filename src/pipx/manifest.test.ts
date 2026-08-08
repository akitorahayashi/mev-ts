import { expect, test } from 'bun:test';
import { parseManifest } from './manifest';

function parsePackage(name: string): ReturnType<typeof parseManifest> {
  return parseManifest(`tools:\n  - package: "${name}"\n`, 'tools.yml');
}

test('parseManifest accepts a conventional package name', () => {
  const entries = parsePackage('yt-dlp');
  expect(entries).toEqual([{ action: 'install', tool: { package: 'yt-dlp' } }]);
});

// A package name is joined into a venv path and then spawned, so a name that
// could traverse out of the venv root or carry a path separator is rejected.
for (const unsafe of ['../evil', 'a/b', '.hidden', '-flag', '']) {
  test(`parseManifest rejects the unsafe package name ${JSON.stringify(unsafe)}`, () => {
    expect(() => parsePackage(unsafe)).toThrow(/package name of letters/);
  });
}

test('parseManifest orders removals ahead of tools', () => {
  const entries = parseManifest(
    'tools:\n  - package: yt-dlp\nuninstall:\n  - mlx-hub\n',
    'tools.yml',
  );
  expect(entries).toEqual([
    { action: 'uninstall', package: 'mlx-hub' },
    { action: 'install', tool: { package: 'yt-dlp' } },
  ]);
});

test('parseManifest treats an omitted uninstall list as nothing to remove', () => {
  const entries = parseManifest('tools:\n  - package: yt-dlp\n', 'tools.yml');
  expect(entries.filter((entry) => entry.action === 'uninstall')).toEqual([]);
});

test('parseManifest rejects a name declared in both tools and uninstall', () => {
  expect(() =>
    parseManifest(
      'tools:\n  - package: yt_dlp\nuninstall:\n  - yt-dlp\n',
      'tools.yml',
    ),
  ).toThrow(/duplicate/);
});

test('parseManifest rejects unsafe uninstall names', () => {
  expect(() =>
    parseManifest('tools: []\nuninstall:\n  - "-flag"\n', 'tools.yml'),
  ).toThrow(/invalid package name/);
});
