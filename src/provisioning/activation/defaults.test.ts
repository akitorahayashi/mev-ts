import { expect, test } from 'bun:test';
import type { AssetSource } from '../../assets/registry';
import { applyDefaultsTree } from './defaults';

/** An asset source whose enumeration is a fixed, injected key set. */
function assetsWithKeys(keys: readonly string[]): AssetSource {
  return {
    async read() {
      return '';
    },
    keysByPrefix(prefix) {
      return keys.filter((key) => key.startsWith(prefix)).sort();
    },
    isExecutable() {
      return false;
    },
  };
}

/** The config keys of the defaults activations produced by the tree factory. */
function configKeys(
  activations: ReturnType<typeof applyDefaultsTree>,
): string[] {
  return activations.map((activation) =>
    activation.kind === 'defaults' ? activation.configKey : '',
  );
}

test('applyDefaultsTree makes one defaults activation per asset under the prefix', () => {
  const activations = applyDefaultsTree(
    assetsWithKeys(['system/dock.yml', 'system/finder.yml', 'other/x.yml']),
    'system/',
  );

  expect(configKeys(activations)).toEqual([
    'system/dock.yml',
    'system/finder.yml',
  ]);
});

test('applyDefaultsTree picks up a newly added key under the prefix', () => {
  const before = applyDefaultsTree(
    assetsWithKeys(['system/dock.yml']),
    'system/',
  );
  const after = applyDefaultsTree(
    assetsWithKeys(['system/dock.yml', 'system/sound.yml']),
    'system/',
  );

  expect(configKeys(before)).toEqual(['system/dock.yml']);
  expect(configKeys(after)).toEqual(['system/dock.yml', 'system/sound.yml']);
});
