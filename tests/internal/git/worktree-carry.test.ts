import { expect, test } from 'bun:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  carryInto,
  readCarryPaths,
} from '../../../src/internal/git/worktree/carry';
import {
  type RecordedCall,
  sequenceRunner,
} from '../../fixtures/fake-command-runner';
import { sandboxedTest } from '../../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('mev-worktree-carry-');

const ok = { code: 0, stdout: '', stderr: '' };

function statusArgs(source: string) {
  return ['-C', source, 'status', '--porcelain', '--ignored', '-z'];
}

function listArgs(source: string, excludes: string) {
  return [
    '-C',
    source,
    'ls-files',
    '-o',
    '-i',
    `--exclude-from=${excludes}`,
    '--directory',
    '-z',
  ];
}

sandboxTest(
  'the carried set is the repository ignores minus the global ones',
  async (sandbox) => {
    const excludes = join(sandbox, 'ignore');
    await writeFile(excludes, '.DS_Store\n.tmp/\n');
    const calls: RecordedCall[] = [];
    const run = sequenceRunner(
      [
        {
          code: 0,
          stdout: ['!! .DS_Store', '!! .tmp/', '!! Pods/', '!! .env']
            .map((entry) => `${entry}\0`)
            .join(''),
          stderr: '',
        },
        { code: 0, stdout: `${excludes}\n`, stderr: '' },
        { code: 0, stdout: '.DS_Store\0.tmp/\0', stderr: '' },
      ],
      calls,
    );

    const paths = await readCarryPaths(run, '/work/demo', () => {});

    expect(paths).toEqual(['Pods/', '.env']);
    expect(calls.map((call) => call.args)).toEqual([
      statusArgs('/work/demo'),
      ['config', '--get', 'core.excludesFile'],
      listArgs('/work/demo', excludes),
    ]);
  },
);

test('a repository with nothing ignored asks no further question', async () => {
  const calls: RecordedCall[] = [];
  const run = sequenceRunner([ok], calls);

  expect(await readCarryPaths(run, '/work/demo', () => {})).toEqual([]);
  // No point resolving the global ignore file when there is nothing to filter.
  expect(calls).toHaveLength(1);
});

sandboxTest(
  'a missing global ignore file is reported rather than assumed empty',
  async (sandbox) => {
    const warnings: string[] = [];
    const run = sequenceRunner(
      [
        { code: 0, stdout: '!! .env\0', stderr: '' },
        { code: 0, stdout: `${join(sandbox, 'absent')}\n`, stderr: '' },
      ],
      [],
    );

    const paths = await readCarryPaths(run, '/work/demo', (line) =>
      warnings.push(line),
    );

    expect(paths).toEqual(['.env']);
    expect(warnings.join('')).toContain('No global ignore file');
  },
);

sandboxTest(
  'a clone carries file content into the destination',
  async (sandbox) => {
    const source = join(sandbox, 'demo');
    const destination = join(sandbox, 'demo-feature-a');
    await mkdir(join(source, 'app'), { recursive: true });
    await mkdir(destination, { recursive: true });
    await writeFile(join(source, 'app', 'Secrets.plist'), 'secret');

    // The real `cp` runs here because cloning is the behavior under test and a
    // fake would only restate the argv this module builds.
    const report = await carryInto(
      {
        run: (command, args) =>
          Bun.spawn([command, ...args]).exited.then((code) => ({
            code,
            stdout: '',
            stderr: '',
          })),
      },
      source,
      destination,
      ['app/Secrets.plist'],
      () => {},
    );

    expect(report.carried).toBe(1);
    expect(
      await readFile(join(destination, 'app', 'Secrets.plist'), 'utf8'),
    ).toBe('secret');
  },
);

sandboxTest(
  'a clone falls back to a plain copy and says so',
  async (sandbox) => {
    const calls: RecordedCall[] = [];
    const run = sequenceRunner(
      [{ code: 1, stdout: '', stderr: 'clonefile failed' }, ok],
      calls,
    );

    const report = await carryInto(run, sandbox, sandbox, ['.env'], () => {});

    expect(calls.map((call) => call.args[0])).toEqual(['-c', '-R']);
    expect(report).toEqual({ carried: 1, copiedWithoutCloning: true });
  },
);

sandboxTest(
  'a path that cannot be copied is named, not swallowed',
  async (sandbox) => {
    const warnings: string[] = [];
    const run = sequenceRunner(
      [
        { code: 1, stdout: '', stderr: 'clonefile failed' },
        { code: 1, stdout: '', stderr: 'No such file or directory' },
      ],
      [],
    );

    const report = await carryInto(run, sandbox, sandbox, ['.env'], (line) =>
      warnings.push(line),
    );

    expect(report.carried).toBe(0);
    expect(warnings.join('')).toContain("Could not carry '.env'");
  },
);
