import { expect, test } from 'bun:test';
import { ProvisioningError } from '../errors';
import { parseManifest } from './manifest';

test('parseManifest reads install and uninstall lists in file order', () => {
  const raw = [
    '# Baseline tools',
    'formulae:',
    '  - ripgrep',
    '  - openssl@3',
    '  - owner/repo/tool',
    'casks:',
    '  - zed',
    'uninstall:',
    '  formulae:',
    '    - redis',
    '  casks:',
    '    - iina',
  ].join('\n');

  expect(parseManifest(raw, 'demo/brew.yml')).toEqual({
    install: {
      formulae: ['ripgrep', 'openssl@3', 'owner/repo/tool'],
      casks: ['zed'],
    },
    uninstall: { formulae: ['redis'], casks: ['iina'] },
  });
});

test('parseManifest treats omitted lists as empty', () => {
  expect(parseManifest('casks:\n  - zed\n', 'demo/brew.yml')).toEqual({
    install: { formulae: [], casks: ['zed'] },
    uninstall: { formulae: [], casks: [] },
  });
  expect(
    parseManifest('uninstall:\n  formulae:\n    - redis\n', 'demo/brew.yml'),
  ).toEqual({
    install: { formulae: [], casks: [] },
    uninstall: { formulae: ['redis'], casks: [] },
  });
});

for (const raw of [
  'taps:\n  - owner/repo\n',
  'formulae:\n  - fd\nmas:\n  - Xcode\n',
  'uninstall:\n  taps:\n    - owner/repo\n',
]) {
  test(`parseManifest refuses the unknown field in ${JSON.stringify(raw)}`, () => {
    expect(() => parseManifest(raw, 'demo/brew.yml')).toThrow(
      'contains unknown field',
    );
  });
}

for (const raw of [
  'formulae: fd\n',
  'formulae:\n  - name: fd\n',
  'uninstall:\n  - fd\n',
  '- fd\n',
]) {
  test(`parseManifest refuses the malformed shape ${JSON.stringify(raw)}`, () => {
    expect(() => parseManifest(raw, 'demo/brew.yml')).toThrow(
      ProvisioningError,
    );
  });
}

for (const name of [
  '-fd',
  '--cask',
  'owner/repo',
  'owner/repo/tool/extra',
  'owner//tool',
  'owner/repo/-tool',
  '../tool',
  'rip#{grep}',
  'rip grep',
  '',
]) {
  test(`parseManifest refuses the invalid name ${JSON.stringify(name)}`, () => {
    expect(() =>
      parseManifest(
        `formulae:\n  - ${JSON.stringify(name)}\n`,
        'demo/brew.yml',
      ),
    ).toThrow(
      'Homebrew manifest demo/brew.yml formulae contains the invalid name',
    );
  });
}

test('parseManifest validates uninstall names like install names', () => {
  expect(() =>
    parseManifest('uninstall:\n  casks:\n    - "-zap"\n', 'demo/brew.yml'),
  ).toThrow(
    "Homebrew manifest demo/brew.yml uninstall casks contains the invalid name '-zap'",
  );
});

test('parseManifest refuses a name declared twice within one kind', () => {
  expect(() =>
    parseManifest('formulae:\n  - fd\n  - fd\n', 'demo/brew.yml'),
  ).toThrow(
    "Homebrew manifest demo/brew.yml formulae contains duplicate 'fd'.",
  );
});

test('parseManifest refuses a name both installed and uninstalled', () => {
  expect(() =>
    parseManifest(
      'casks:\n  - zed\nuninstall:\n  casks:\n    - zed\n',
      'demo/brew.yml',
    ),
  ).toThrow("Homebrew manifest demo/brew.yml casks contains duplicate 'zed'.");
});

test('parseManifest keeps a formula and a cask of the same name apart', () => {
  expect(
    parseManifest(
      'formulae:\n  - docker\ncasks:\n  - docker\n',
      'demo/brew.yml',
    ),
  ).toEqual({
    install: { formulae: ['docker'], casks: ['docker'] },
    uninstall: { formulae: [], casks: [] },
  });
});
