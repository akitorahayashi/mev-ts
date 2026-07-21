import { describe, expect, test } from 'bun:test';
import { brewPath, brewPrefixCapture } from './brew-path';

describe('brewPrefixCapture', () => {
  test('captures the brew prefix without counting as a change', () => {
    expect(brewPrefixCapture()).toEqual({
      label: 'brew prefix',
      argv: ['brew', '--prefix'],
      capture: 'brewPrefix',
      changedWhen: 'never',
    });
  });
});

describe('brewPath', () => {
  test('composes a PATH with brew bin ahead of the inherited PATH', () => {
    expect(brewPath()).toEqual({
      PATH: {
        pathList: [
          { concat: [{ ref: 'brewPrefix' }, '/bin'] },
          { ref: 'basePath' },
        ],
      },
    });
  });

  test('inserts leading entries between brew bin and the base path', () => {
    expect(brewPath(['/home/user/.local/bin'])).toEqual({
      PATH: {
        pathList: [
          { concat: [{ ref: 'brewPrefix' }, '/bin'] },
          '/home/user/.local/bin',
          { ref: 'basePath' },
        ],
      },
    });
  });
});
