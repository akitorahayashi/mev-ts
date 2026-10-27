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

test('every ignored path is carried except the shared .tmp', async () => {
  const calls: RecordedCall[] = [];
  const run = sequenceRunner(
    [
      {
        code: 0,
        stdout: [
          '!! .DS_Store',
          '!! .tmp/',
          '!! Pods/',
          '!! .env',
          '!! .claude/settings.local.json',
        ]
          .map((entry) => `${entry}\0`)
          .join(''),
        stderr: '',
      },
    ],
    calls,
  );

  const paths = await readCarryPaths(run, '/work/demo');

  expect(paths).toEqual([
    '.DS_Store',
    'Pods/',
    '.env',
    '.claude/settings.local.json',
  ]);
  expect(calls.map((call) => call.args)).toEqual([
    ['-C', '/work/demo', 'status', '--porcelain', '--ignored', '-z'],
  ]);
});

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
  'a path the destination branch tracks is left alone',
  async (sandbox) => {
    const source = join(sandbox, 'demo');
    const destination = join(sandbox, 'demo-feature-a');
    await mkdir(source, { recursive: true });
    await mkdir(join(destination, 'Pods'), { recursive: true });
    await writeFile(join(source, '.env'), 'from main');
    await writeFile(join(destination, '.env'), 'committed on this branch');

    const warnings: string[] = [];
    // Nothing is spawned: both destinations already exist, and a worktree git
    // has just created holds only what its branch tracks.
    const run = sequenceRunner([], []);

    const report = await carryInto(
      run,
      source,
      destination,
      ['.env', 'Pods/'],
      (line) => warnings.push(line),
    );

    expect(report.carried).toBe(0);
    expect(await readFile(join(destination, '.env'), 'utf8')).toBe(
      'committed on this branch',
    );
    expect(warnings.join('')).toContain("Left '.env' alone");
    expect(warnings.join('')).toContain("Left 'Pods/' alone");
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
