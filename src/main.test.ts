import { expect, test } from 'bun:test';
import { rewriteNamespaceHelp } from './main';

const paths = [
  ['config'],
  ['cf'],
  ['config', 'agents'],
  ['cf', 'agents'],
  ['make'],
  ['list'],
  ['user'],
  ['user', 'show'],
];

const rewrite = (args: readonly string[]): readonly string[] =>
  rewriteNamespaceHelp(args, paths);

test('rewrites a namespace --help to the bare namespace', () => {
  expect(rewrite(['config', '--help'])).toEqual(['config']);
  expect(rewrite(['config', '-h'])).toEqual(['config']);
  expect(rewrite(['cf', '--help'])).toEqual(['cf']);
  expect(rewrite(['user', '--help'])).toEqual(['user']);
});

test('leaves a leaf command --help untouched (no subcommands)', () => {
  expect(rewrite(['make', '--help'])).toEqual(['make', '--help']);
  expect(rewrite(['list', '--help'])).toEqual(['list', '--help']);
});

test('leaves an unknown namespace untouched', () => {
  expect(rewrite(['nope', '--help'])).toEqual(['nope', '--help']);
});

test('leaves non-help and non-two-token invocations untouched', () => {
  expect(rewrite(['config'])).toEqual(['config']);
  expect(rewrite(['config', 'agents', '--help'])).toEqual([
    'config',
    'agents',
    '--help',
  ]);
  expect(rewrite(['make', 'git'])).toEqual(['make', 'git']);
});
