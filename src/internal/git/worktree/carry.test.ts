import { expect, test } from 'bun:test';
import { parseIgnored, parseListed, subtractGlobal } from './carry';

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

test('a listing drops the trailing empty field', () => {
  expect(parseListed('.DS_Store\0.tmp/\0')).toEqual(['.DS_Store', '.tmp/']);
});

test('the global set is removed from the candidates', () => {
  const candidates = ['.DS_Store', 'Pods/', '.tmp/', '.env'];

  expect(subtractGlobal(candidates, ['.DS_Store', '.tmp/'])).toEqual([
    'Pods/',
    '.env',
  ]);
});

test('a path the repository also ignores is still dropped as global', () => {
  // The exclusion is by pattern, not by which file git credits for the match:
  // a repository listing .DS_Store in its own .gitignore would otherwise carry
  // it into every worktree it creates.
  expect(subtractGlobal(['.DS_Store', '.env'], ['.DS_Store'])).toEqual([
    '.env',
  ]);
});

test('an empty global set carries every candidate', () => {
  expect(subtractGlobal(['Pods/', '.env'], [])).toEqual(['Pods/', '.env']);
});
