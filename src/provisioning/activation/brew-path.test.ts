import { describe, expect, test } from 'bun:test';
import { brewPath } from './brew-path';
import type { CommandScope } from './contract';

function fakeScope(brewPrefix: string, basePath: string): CommandScope {
  return {
    home: '/home/user',
    basePath,
    ref(name) {
      if (name === 'brewPrefix') return brewPrefix;
      throw new Error(`unexpected ref '${name}'`);
    },
  };
}

describe('brewPath', () => {
  test('puts brew bin ahead of the inherited PATH', () => {
    const scope = fakeScope('/opt/homebrew', '/usr/bin:/bin');
    expect(brewPath(scope)).toEqual({
      PATH: '/opt/homebrew/bin:/usr/bin:/bin',
    });
  });

  test('inserts leading entries between brew bin and the base path', () => {
    const scope = fakeScope('/opt/homebrew', '/usr/bin');
    expect(brewPath(scope, ['/home/user/.local/bin'])).toEqual({
      PATH: '/opt/homebrew/bin:/home/user/.local/bin:/usr/bin',
    });
  });

  test('derives brew bin from the captured prefix rather than a fixed location', () => {
    const scope = fakeScope('/usr/local', '/usr/bin');
    expect(brewPath(scope)).toEqual({ PATH: '/usr/local/bin:/usr/bin' });
  });

  test('drops an empty base path rather than emitting a trailing separator', () => {
    const scope = fakeScope('/usr/local', '');
    expect(brewPath(scope)).toEqual({ PATH: '/usr/local/bin' });
  });
});
