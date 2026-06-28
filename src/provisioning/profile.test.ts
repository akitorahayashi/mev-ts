import { expect, test } from 'bun:test';
import { CommandLineError } from '../errors';
import { resolveProfile } from './profile';

test('a canonical identifier resolves to itself', () => {
  expect(resolveProfile('macbook')).toBe('macbook');
  expect(resolveProfile('mac-mini')).toBe('mac-mini');
});

test('an alias resolves to its canonical profile', () => {
  expect(resolveProfile('mbk')).toBe('macbook');
  expect(resolveProfile('mmn')).toBe('mac-mini');
});

test('an unknown profile is rejected as a usage error', () => {
  expect(() => resolveProfile('glb')).toThrow(CommandLineError);
  expect(() => resolveProfile('desktop')).toThrow(CommandLineError);
});
