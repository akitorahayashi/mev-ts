import { expect, test } from 'bun:test';
import {
  deployLabels,
  LABEL_CATALOG,
  resetLabels,
} from '../../../src/mev/internal/gh/labels';
import type {
  CommandResult,
  CommandRunner,
} from '../../../src/mev/resources/model';

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

test('LABEL_CATALOG contains 16 labels', () => {
  expect(LABEL_CATALOG.length).toBe(16);
});

test('deployLabels creates labels absent from the repository', async () => {
  const calls: Call[] = [];
  const responses: CommandResult[] = [
    { code: 0, stdout: '[]', stderr: '' },
    ...LABEL_CATALOG.map(() => ({ code: 0, stdout: '', stderr: '' })),
  ];
  const run = sequenceRunner(responses, calls);

  await deployLabels(run);

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

test('deployLabels edits labels already present in the repository', async () => {
  const allNames = LABEL_CATALOG.map((l) =>
    JSON.stringify({ name: l.name }),
  ).join(',');
  const calls: Call[] = [];
  const responses: CommandResult[] = [
    { code: 0, stdout: `[${allNames}]`, stderr: '' },
    ...LABEL_CATALOG.map(() => ({ code: 0, stdout: '', stderr: '' })),
  ];
  const run = sequenceRunner(responses, calls);

  await deployLabels(run);

  for (let i = 1; i <= LABEL_CATALOG.length; i++) {
    expect(calls[i]?.args[1]).toBe('edit');
  }
});

test('deployLabels edits labels whose existing name differs only by case', async () => {
  const lowercaseNames = LABEL_CATALOG.map((l) =>
    JSON.stringify({ name: l.name.toLowerCase() }),
  ).join(',');
  const calls: Call[] = [];
  const responses: CommandResult[] = [
    { code: 0, stdout: `[${lowercaseNames}]`, stderr: '' },
    ...LABEL_CATALOG.map(() => ({ code: 0, stdout: '', stderr: '' })),
  ];
  const run = sequenceRunner(responses, calls);

  await deployLabels(run);

  for (let i = 1; i <= LABEL_CATALOG.length; i++) {
    expect(calls[i]?.args[1]).toBe('edit');
  }
});

test('deployLabels passes --repo to all operations', async () => {
  const calls: Call[] = [];
  const responses: CommandResult[] = [
    { code: 0, stdout: '[]', stderr: '' },
    ...LABEL_CATALOG.map(() => ({ code: 0, stdout: '', stderr: '' })),
  ];
  const run = sequenceRunner(responses, calls);

  await deployLabels(run, 'owner/repo');

  for (const call of calls) {
    expect(call.args).toContain('owner/repo');
  }
});

test('resetLabels deletes all existing labels', async () => {
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

  await resetLabels(run);

  expect(calls).toHaveLength(3);
  expect(calls[1]?.args).toEqual(['label', 'delete', 'C-bugs', '--yes']);
  expect(calls[2]?.args).toEqual(['label', 'delete', 'C-feats', '--yes']);
});

test('resetLabels does nothing when repository has no labels', async () => {
  const calls: Call[] = [];
  const run = sequenceRunner([{ code: 0, stdout: '[]', stderr: '' }], calls);

  await resetLabels(run);

  expect(calls).toHaveLength(1);
});
