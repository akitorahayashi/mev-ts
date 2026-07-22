import { expect, test } from 'bun:test';
import { CommandLineError, ProvisioningError } from '../../../src/errors';
import { cloneRepositories } from '../../../src/internal/git/clone';
import {
  type RecordedCall,
  sequenceRunner,
} from '../../fixtures/fake-command-runner';

test('clones each url in order', async () => {
  const calls: RecordedCall[] = [];
  const run = sequenceRunner([], calls);

  await cloneRepositories(run, ['urlA', 'urlB']);

  expect(calls).toEqual([
    { args: ['clone', 'urlA'], stdout: 'inherit', stderr: 'inherit' },
    { args: ['clone', 'urlB'], stdout: 'inherit', stderr: 'inherit' },
  ]);
});

test('applies flags after the separator to every clone', async () => {
  const calls: RecordedCall[] = [];
  const run = sequenceRunner([], calls);

  await cloneRepositories(run, ['urlA', 'urlB', '--', '--depth', '1']);

  expect(calls).toEqual([
    {
      args: ['clone', '--depth', '1', 'urlA'],
      stdout: 'inherit',
      stderr: 'inherit',
    },
    {
      args: ['clone', '--depth', '1', 'urlB'],
      stdout: 'inherit',
      stderr: 'inherit',
    },
  ]);
});

test('rejects a repository URL that could be read as a git flag', async () => {
  const calls: RecordedCall[] = [];
  const run = sequenceRunner([], calls);

  await expect(
    cloneRepositories(run, ['--upload-pack=evil']),
  ).rejects.toBeInstanceOf(CommandLineError);
  expect(calls).toHaveLength(0);
});

test('stops at the first failure', async () => {
  const calls: RecordedCall[] = [];
  const run = sequenceRunner([{ code: 1, stdout: '', stderr: 'boom' }], calls);

  await expect(cloneRepositories(run, ['urlA', 'urlB'])).rejects.toBeInstanceOf(
    ProvisioningError,
  );
  expect(calls).toHaveLength(1);
});

test('reports inherited clone failures without pretending output was captured', async () => {
  const calls: RecordedCall[] = [];
  const run = sequenceRunner([{ code: 1, stdout: '', stderr: '' }], calls);

  await expect(cloneRepositories(run, ['urlA'])).rejects.toThrow(
    'git clone urlA failed with code 1: see command output above',
  );
});

test('redacts clone URL credentials from progress and failure output', async () => {
  const calls: RecordedCall[] = [];
  const messages: string[] = [];
  const run = sequenceRunner([{ code: 1, stdout: '', stderr: '' }], calls);
  const url = 'https://user:secret@example.com/owner/repo.git';

  await expect(
    cloneRepositories(run, [url], (message) => messages.push(message)),
  ).rejects.toThrow(
    'git clone https://REDACTED@example.com/owner/repo.git failed with code 1: see command output above',
  );

  expect(messages).toEqual([
    'Cloning https://REDACTED@example.com/owner/repo.git...\n',
  ]);
  expect(calls[0]?.args).toEqual(['clone', url]);
});
