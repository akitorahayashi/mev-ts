import { expect, test } from 'bun:test';
import { ProvisioningError } from '../errors';
import { parseManifest } from './manifest';

test('parseManifest reads tap, brew, and cask declarations in file order', () => {
  const raw = [
    '# Baseline tools',
    'tap "owner/repo"',
    '',
    'brew "ripgrep"',
    'cask "zed"  # editor',
    'brew "openssl@3"',
    '  brew "owner/repo/tool"',
  ].join('\n');

  expect(parseManifest(raw, 'demo/Brewfile')).toEqual({
    taps: ['owner/repo'],
    formulae: ['ripgrep', 'openssl@3', 'owner/repo/tool'],
    casks: ['zed'],
  });
});

test('parseManifest treats a file of comments as no requirements', () => {
  expect(parseManifest('# nothing yet\n', 'demo/Brewfile')).toEqual({
    taps: [],
    formulae: [],
    casks: [],
  });
});

for (const line of [
  'brew "ripgrep", args: ["HEAD"]',
  'cask "docker", greedy: true',
  "brew 'ripgrep'",
  'mas "Xcode", id: 497799835',
  'vscode "golang.go"',
  'brew "ripgrep" if OS.mac?',
  'brew ""',
  'brew',
]) {
  test(`parseManifest refuses the unsupported line ${JSON.stringify(line)}`, () => {
    expect(() => parseManifest(`${line}\n`, 'demo/Brewfile')).toThrow(
      'Brewfile demo/Brewfile:1 must declare one double-quoted',
    );
  });
}

test('parseManifest refuses a name outside the Homebrew character set', () => {
  expect(() => parseManifest('brew "rip#{grep}"\n', 'demo/Brewfile')).toThrow(
    new ProvisioningError(
      "Brewfile demo/Brewfile:1 declares the unsafe name 'rip#{grep}'; names may contain only letters, digits, and ._@/+- characters.",
    ),
  );
});

test('parseManifest refuses a duplicate declaration and names its line', () => {
  expect(() =>
    parseManifest('brew "fd"\ncask "fd"\nbrew "fd"\n', 'demo/Brewfile'),
  ).toThrow("Brewfile demo/Brewfile:3 declares brew 'fd' more than once.");
});
