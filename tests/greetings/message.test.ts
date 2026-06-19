import { describe, expect, test } from 'bun:test';
import { composeGreetingMessage } from '../../src/bun_cli/greetings/message';

describe('composeGreetingMessage', () => {
  test('creates an English greeting', () => {
    expect(composeGreetingMessage({ name: 'Alice', lang: 'en' })).toBe(
      'Hello, Alice!',
    );
  });

  test('creates a Japanese greeting', () => {
    expect(composeGreetingMessage({ name: 'Hanako', lang: 'ja' })).toBe(
      'こんにちは、Hanakoさん！',
    );
  });

  test('rejects blank names', () => {
    expect(() => composeGreetingMessage({ name: '   ', lang: 'en' })).toThrow(
      'Name is required.',
    );
  });
});
