import { expect, test } from 'bun:test';
import { parseTools } from './manifest';

function parsePackage(name: string): ReturnType<typeof parseTools> {
  return parseTools(`tools:\n  - package: "${name}"\n`, 'tools.yml');
}

test('parseTools accepts a conventional package name', () => {
  expect(parsePackage('yt-dlp')[0]?.package).toBe('yt-dlp');
});

// A package name is joined into a venv path and then spawned, so a name that
// could traverse out of the venv root or carry a path separator is rejected.
for (const unsafe of ['../evil', 'a/b', '.hidden', '-flag', '']) {
  test(`parseTools rejects the unsafe package name ${JSON.stringify(unsafe)}`, () => {
    expect(() => parsePackage(unsafe)).toThrow(/package name of letters/);
  });
}
