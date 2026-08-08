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

for (const pin of ['2024.4.9', '1.0', '2.0rc1', '1!2.0', '1.0.post1.dev2']) {
  test(`parseManifest accepts the exact version pin ${pin}`, () => {
    expect(parseVersion(pin)).toEqual([
      { action: 'install', tool: { package: 'yt-dlp', version: pin } },
    ]);
  });
}

// Leading zeros are stripped from every numeric component, not only the
// release segments.
for (const unusable of [
  '>=1.2',
  '~=1.2',
  '1.*',
  '1.0.0-rc1',
  '01.2',
  '1.0rc01',
  '1.0.post01',
  '1.0.dev01',
  '01!2.0',
]) {
  test(`parseManifest rejects the unusable version ${JSON.stringify(unusable)}`, () => {
    expect(() => parseVersion(unusable)).toThrow(
      /'version' must be 'latest' or an exact version pin/,
    );
  });
}

// YAML types these as numbers, which no longer name the pin that was written.
for (const numeric of ['1.0', '1.10', '20250625']) {
  test(`parseManifest rejects the unquoted version ${numeric}`, () => {
    expect(() =>
      parseManifest(`tools:\n  yt-dlp: ${numeric}\n`, 'tools.yml'),
    ).toThrow(/must be quoted so YAML preserves it as written/);
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

test('parseManifest rejects a bare scalar that is no kind of version', () => {
  expect(() =>
    parseManifest('tools:\n  yt-dlp: [1, 2]\n', 'tools.yml'),
  ).toThrow(/'version' must be 'latest' or an exact version pin/);
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
