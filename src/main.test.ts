import { expect, test } from 'bun:test';
import { rewriteNamespaceHelp, runCommandLine } from './main';

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

async function captureCommandLine(args: readonly string[]) {
  let stdout = '';
  const code = await runCommandLine(args, {
    colorDepth: 1,
    stdout: {
      write(chunk: string | Uint8Array) {
        stdout += String(chunk);
        return true;
      },
    } as NodeJS.WriteStream,
  });
  return { code, stdout };
}

test('profile command help lists every accepted profile identifier', async () => {
  const sync = await captureCommandLine(['s', '-h']);
  const create = await captureCommandLine(['cr', '-h']);

  expect(sync.code).toBe(0);
  expect(sync.stdout).toContain('$ mev sync <macbook|mbk|mac-mini|mmn>');
  expect(create.code).toBe(0);
  expect(create.stdout).toContain('$ mev create <macbook|mbk|mac-mini|mmn>');
});

test('missing profile errors show every accepted profile identifier', async () => {
  const sync = await captureCommandLine(['sync']);
  const create = await captureCommandLine(['create']);

  expect(sync.code).toBe(1);
  expect(sync.stdout).toContain('$ mev sync <macbook|mbk|mac-mini|mmn>');
  expect(create.code).toBe(1);
  expect(create.stdout).toContain('$ mev create <macbook|mbk|mac-mini|mmn>');
});
