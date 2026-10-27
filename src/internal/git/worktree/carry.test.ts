import { expect, test } from 'bun:test';
import { parseIgnored } from './carry';

test('reads only the ignored entries out of a status listing', () => {
  const stdout = ['!! Pods/', ' M src/a.ts', '?? scratch.txt', '!! .env']
    .map((entry) => `${entry}\0`)
    .join('');

  expect(parseIgnored(stdout)).toEqual(['Pods/', '.env']);
});

test('a clean status carries nothing', () => {
  expect(parseIgnored('')).toEqual([]);
});

test('an ignored path containing spaces stays one entry', () => {
  expect(parseIgnored('!! my config/local settings.json\0')).toEqual([
    'my config/local settings.json',
  ]);
});
