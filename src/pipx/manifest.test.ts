import { expect, test } from 'bun:test';
import { parseManifest } from './manifest';

function parsePackage(name: string): ReturnType<typeof parseManifest> {
  return parseManifest(`tools:\n  "${name}": latest\n`, 'tools.yml');
}

function parseVersion(version: string): ReturnType<typeof parseManifest> {
  return parseManifest(`tools:\n  yt-dlp: "${version}"\n`, 'tools.yml');
}

test('parseManifest accepts a conventional package name', () => {
  const entries = parsePackage('yt-dlp');
  expect(entries).toEqual([
    { action: 'install', tool: { package: 'yt-dlp', version: 'latest' } },
  ]);
});

// A package name is joined into a venv path and then spawned, so a name that
// could traverse out of the venv root or carry a path separator is rejected.
for (const unsafe of ['../evil', 'a/b', '.hidden', '-flag', '']) {
  test(`parseManifest rejects the unsafe package name ${JSON.stringify(unsafe)}`, () => {
    expect(() => parsePackage(unsafe)).toThrow(/must contain only letters/);
  });
}

test('parseManifest requires a declared version', () => {
  expect(() => parseManifest('tools:\n  yt-dlp: {}\n', 'tools.yml')).toThrow(
    /'version' must be 'latest' or an exact version pin/,
  );
});

test('parseManifest accepts an exact version pin', () => {
  expect(parseVersion('2024.4.9')).toEqual([
    { action: 'install', tool: { package: 'yt-dlp', version: '2024.4.9' } },
  ]);
  expect(parseVersion('1.0')).toEqual([
    { action: 'install', tool: { package: 'yt-dlp', version: '1.0' } },
  ]);
  expect(parseVersion('2.0rc1')).toEqual([
    { action: 'install', tool: { package: 'yt-dlp', version: '2.0rc1' } },
  ]);
});

// A pin is compared literally against the version pipx reports, so anything pip
// would resolve or normalize away can never compare equal.
for (const unusable of ['>=1.2', '~=1.2', '1.*', '1.0.0-rc1', '01.2']) {
  test(`parseManifest rejects the unusable version ${JSON.stringify(unusable)}`, () => {
    expect(() => parseVersion(unusable)).toThrow(
      /'version' must be 'latest' or an exact version pin/,
    );
  });
}

test('parseManifest accepts the mapping form for inject and post_install', () => {
  const entries = parseManifest(
    [
      'tools:',
      '  browser-tool:',
      '    version: 1.0.0',
      '    inject:',
      '      - browser-driver',
      '    post_install:',
      '      bin: browser-tool',
      '      args: [setup]',
      '',
    ].join('\n'),
    'tools.yml',
  );
  expect(entries).toEqual([
    {
      action: 'install',
      tool: {
        package: 'browser-tool',
        version: '1.0.0',
        inject: ['browser-driver'],
        post_install: { bin: 'browser-tool', args: ['setup'] },
      },
    },
  ]);
});

test('parseManifest rejects a bare scalar that is not a string version', () => {
  expect(() => parseManifest('tools:\n  yt-dlp: 42\n', 'tools.yml')).toThrow(
    /must be a version or a mapping with 'version'/,
  );
});

test('parseManifest orders removals ahead of tools', () => {
  const entries = parseManifest(
    'tools:\n  yt-dlp: latest\nuninstall:\n  - mlx-hub\n',
    'tools.yml',
  );
  expect(entries).toEqual([
    { action: 'uninstall', package: 'mlx-hub' },
    { action: 'install', tool: { package: 'yt-dlp', version: 'latest' } },
  ]);
});

test('parseManifest treats an omitted uninstall list as nothing to remove', () => {
  const entries = parsePackage('yt-dlp');
  expect(entries.filter((entry) => entry.action === 'uninstall')).toEqual([]);
});

test('parseManifest rejects a name declared in both tools and uninstall', () => {
  expect(() =>
    parseManifest(
      'tools:\n  yt_dlp: latest\nuninstall:\n  - yt-dlp\n',
      'tools.yml',
    ),
  ).toThrow(/duplicate/);
});

test('parseManifest rejects unsafe uninstall names', () => {
  expect(() =>
    parseManifest('tools: {}\nuninstall:\n  - "-flag"\n', 'tools.yml'),
  ).toThrow(/invalid package name/);
});
