import { expect, test } from 'bun:test';
import { ProvisioningError } from '../errors';
import { parseManifest } from './manifest';

test('model declarations retain order and only explicit removals are scheduled', () => {
  expect(
    parseManifest(
      'models:\n  - publisher/vision\n  - gpt2\nuninstall:\n  - publisher/old\n',
      'models.yml',
    ),
  ).toEqual([
    { action: 'uninstall', repo: 'publisher/old' },
    { action: 'install', repo: 'publisher/vision' },
    { action: 'install', repo: 'gpt2' },
  ]);
  expect(parseManifest('models: []', 'models.yml')).toEqual([]);
  expect(parseManifest('models:\n  - publisher/vision', 'models.yml')).toEqual([
    { action: 'install', repo: 'publisher/vision' },
  ]);
});

test.each([
  'models: {}',
  'models: [123]',
  'models: []\nuninstall: {}',
  'models: []\nunknown: []',
  'uninstall: []',
  'models: [publisher/vision, publisher/vision]',
  'models: [publisher/vision]\nuninstall: [publisher/vision]',
  'models: []\nuninstall: [publisher/old, publisher/old]',
])('invalid model manifests fail before any operation: %s', (raw) => {
  expect(() => parseManifest(raw, 'models.yml')).toThrow(ProvisioningError);
});

test.each([
  '--help',
  '../vision',
  'publisher/../vision',
  'publisher/vision/subdirectory',
  'https://huggingface.co/publisher/vision',
  '/vision',
  'publisher/',
  'publisher/vision.git',
  'publisher/vision@main',
])('invalid repository IDs are rejected for both actions: %s', (repo) => {
  for (const raw of [
    `models: ["${repo}"]`,
    `models: []\nuninstall: ["${repo}"]`,
  ]) {
    expect(() => parseManifest(raw, 'models.yml')).toThrow(ProvisioningError);
  }
});
