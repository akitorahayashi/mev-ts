import { expect, test } from 'bun:test';
import type { CommandResult, CommandRunner } from '../../../src/host/command';
import {
  buildDeployTasks,
  buildResetTasks,
  LABEL_CATALOG,
} from '../../../src/internal/gh/labels';

interface Call {
  args: string[];
}

function sequenceRunner(
  responses: CommandResult[],
  calls: Call[],
): CommandRunner {
  let index = 0;
  return {
    async run(_command, args): Promise<CommandResult> {
      calls.push({ args: [...args] });
      return responses[index++] ?? { code: 0, stdout: '', stderr: '' };
    },
  };
}

async function runAllTasks(tasks: { run: () => Promise<void> }[]) {
  await Promise.all(tasks.map((task) => task.run()));
}

test('buildDeployTasks creates labels absent from the repository', async () => {
  const calls: Call[] = [];
  const responses: CommandResult[] = [
    { code: 0, stdout: '[]', stderr: '' },
    ...LABEL_CATALOG.map(() => ({ code: 0, stdout: '', stderr: '' })),
  ];
  const run = sequenceRunner(responses, calls);

  await runAllTasks(await buildDeployTasks(run));

  expect(calls[0]?.args).toEqual([
    'label',
    'list',
    '--json',
    'name',
    '--limit',
    '1000',
  ]);
  for (let i = 1; i <= LABEL_CATALOG.length; i++) {
    expect(calls[i]?.args[1]).toBe('create');
  }
});

test('buildDeployTasks edits labels already present in the repository', async () => {
  const allNames = LABEL_CATALOG.map((l) =>
    JSON.stringify({ name: l.name }),
  ).join(',');
  const calls: Call[] = [];
  const responses: CommandResult[] = [
    { code: 0, stdout: `[${allNames}]`, stderr: '' },
    ...LABEL_CATALOG.map(() => ({ code: 0, stdout: '', stderr: '' })),
  ];
  const run = sequenceRunner(responses, calls);

  await runAllTasks(await buildDeployTasks(run));

  for (let i = 1; i <= LABEL_CATALOG.length; i++) {
    expect(calls[i]?.args[1]).toBe('edit');
  }
});

test('buildDeployTasks edits labels whose existing name differs only by case', async () => {
  const lowercaseNames = LABEL_CATALOG.map((l) =>
    JSON.stringify({ name: l.name.toLowerCase() }),
  ).join(',');
  const calls: Call[] = [];
  const responses: CommandResult[] = [
    { code: 0, stdout: `[${lowercaseNames}]`, stderr: '' },
    ...LABEL_CATALOG.map(() => ({ code: 0, stdout: '', stderr: '' })),
  ];
  const run = sequenceRunner(responses, calls);

  await runAllTasks(await buildDeployTasks(run));

  for (let i = 1; i <= LABEL_CATALOG.length; i++) {
    expect(calls[i]?.args[1]).toBe('edit');
  }
});

test('buildDeployTasks passes --repo to all operations', async () => {
  const calls: Call[] = [];
  const responses: CommandResult[] = [
    { code: 0, stdout: '[]', stderr: '' },
    ...LABEL_CATALOG.map(() => ({ code: 0, stdout: '', stderr: '' })),
  ];
  const run = sequenceRunner(responses, calls);

  await runAllTasks(await buildDeployTasks(run, 'owner/repo'));

  for (const call of calls) {
    expect(call.args).toContain('owner/repo');
  }
});

test('buildResetTasks deletes all existing labels', async () => {
  const names = ['C-bugs', 'C-feats'];
  const calls: Call[] = [];
  const responses: CommandResult[] = [
    {
      code: 0,
      stdout: JSON.stringify(names.map((n) => ({ name: n }))),
      stderr: '',
    },
    { code: 0, stdout: '', stderr: '' },
    { code: 0, stdout: '', stderr: '' },
  ];
  const run = sequenceRunner(responses, calls);

  await runAllTasks(await buildResetTasks(run));

  expect(calls).toHaveLength(3);
  expect(calls[1]?.args).toEqual(['label', 'delete', 'C-bugs', '--yes']);
  expect(calls[2]?.args).toEqual(['label', 'delete', 'C-feats', '--yes']);
});

test('buildResetTasks does nothing when repository has no labels', async () => {
  const calls: Call[] = [];
  const run = sequenceRunner([{ code: 0, stdout: '[]', stderr: '' }], calls);

  await runAllTasks(await buildResetTasks(run));

  expect(calls).toHaveLength(1);
});
