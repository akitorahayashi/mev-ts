import { expect, test } from 'bun:test';
import {
  branchNameProblem,
  displayName,
  exceedsNameLimit,
  layoutFor,
  pathFor,
  slug,
  suffixOf,
  suffixProblem,
} from './layout';

const layout = layoutFor('/work/demo');

test('derives sibling paths from the main worktree', () => {
  expect(layout).toEqual({ container: '/work', repo: 'demo' });
  expect(pathFor(layout, 'feature-a')).toBe('/work/demo-feature-a');
});

test('replaces every slash in a branch name', () => {
  expect(slug('feature/api/v2')).toBe('feature-api-v2');
});

test('reads back the suffix of a sibling worktree', () => {
  expect(suffixOf(layout, '/work/demo-feature-a')).toBe('feature-a');
});

test('reports no suffix for a worktree outside the naming rule', () => {
  expect(suffixOf(layout, '/work/unrelated')).toBeNull();
});

test('shows siblings by name and everything else by absolute path', () => {
  expect(displayName(layout, '/work/demo-feature-a')).toBe('demo-feature-a');
  expect(displayName(layout, '/work/demo')).toBe('demo');
  expect(displayName(layout, '/elsewhere/thing')).toBe('/elsewhere/thing');
});

test('normalizes a decomposed path to the precomposed token', () => {
  // macOS returns the directory name decomposed while the branch name that
  // produced it stays precomposed, so the two would not compare equal.
  const decomposed = '/work/demo-cafe\u0301';
  expect(suffixOf(layout, decomposed)).toBe('caf\u00e9');
});

test('measures the name limit in bytes rather than code units', () => {
  expect(exceedsNameLimit('a'.repeat(255))).toBe(false);
  expect(exceedsNameLimit('a'.repeat(256))).toBe(true);
  // Three-byte characters reach the limit at a third of the code-unit count.
  expect(exceedsNameLimit('あ'.repeat(86))).toBe(true);
  expect(exceedsNameLimit('あ'.repeat(85))).toBe(false);
});

test.each([
  ['', 'must not be empty'],
  ['-x', "must not start with '-'"],
  ['feature/a b', 'must not contain a space'],
  ['feature/a~1', 'must not contain a space'],
  ['feature/a\\b', 'must not contain a space'],
  ['feature/../a', "must not contain '..'"],
  ['@{-1}', "must not contain '@{'"],
  ['@', "must not be '@'"],
  ['HEAD', "must not be 'HEAD'"],
  ['feature/', 'must not have an empty path component'],
  ['feature//a', 'must not have an empty path component'],
  ['feature/a.', "must not end with '.'"],
  ['feature/.a', "must not have a component starting with '.'"],
  ['feature/a.lock', "must not have a component ending with '.lock'"],
])('rejects the branch name %p', (branch, expected) => {
  expect(branchNameProblem(branch)).toContain(expected as string);
});

test.each([
  'main',
  'feature/a',
  'feature/api/v2',
  'release-1.0',
])('accepts the branch name %p', (branch) => {
  expect(branchNameProblem(branch)).toBeNull();
});

test.each([
  ['', 'must not be empty'],
  ['-x', "must not start with '-'"],
  ['a/b', 'must not contain a path separator'],
  ['a\\b', 'must not contain a path separator'],
  ['..', "must not be '.' or '..'"],
])('rejects the worktree name %p', (suffix, expected) => {
  expect(suffixProblem(suffix)).toBe(expected as string);
});

test('accepts a plain worktree name', () => {
  expect(suffixProblem('signup-v2')).toBeNull();
});
