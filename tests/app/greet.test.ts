import { describe, expect, test } from 'bun:test';
import { greet } from '../../src/bun_cli/app/greet';

describe('greet application', () => {
  test('returns the selected language and message', () => {
    expect(greet({ name: 'Hanako', lang: 'ja' })).toEqual({
      lang: 'ja',
      message: 'こんにちは、Hanakoさん！',
    });
  });

  test('defaults language to Japanese', () => {
    expect(greet({ name: 'Alice' })).toEqual({
      lang: 'ja',
      message: 'こんにちは、Aliceさん！',
    });
  });
});
