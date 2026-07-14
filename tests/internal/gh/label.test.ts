import { expect, test } from 'bun:test';
import { ProvisioningError } from '../../../src/errors';
import {
  createLabel,
  deleteLabel,
  editLabel,
  listLabelNames,
} from '../../../src/internal/gh/label';
import { presetRunner } from '../../fixtures/fake-command-runner';

const label = {
  name: 'C-bugs',
  color: 'd73a4a',
  description: "Something isn't working",
};

test('listLabelNames parses JSON name array', async () => {
  const run = presetRunner({
    code: 0,
    stdout: '[{"name":"C-bugs"},{"name":"C-feats"}]',
    stderr: '',
  });
  expect(await listLabelNames(run)).toEqual(['C-bugs', 'C-feats']);
});

test('listLabelNames returns empty array for empty repository', async () => {
  const run = presetRunner({ code: 0, stdout: '[]', stderr: '' });
  expect(await listLabelNames(run)).toEqual([]);
});

test('listLabelNames passes correct argv without repo', async () => {
  const sink: { args?: string[] } = {};
  const run = presetRunner({ code: 0, stdout: '[]', stderr: '' }, sink);
  await listLabelNames(run);
  expect(sink.args).toEqual([
    'label',
    'list',
    '--json',
    'name',
    '--limit',
    '1000',
  ]);
});

test('listLabelNames appends --repo when provided', async () => {
  const sink: { args?: string[] } = {};
  const run = presetRunner({ code: 0, stdout: '[]', stderr: '' }, sink);
  await listLabelNames(run, 'owner/repo');
  expect(sink.args).toEqual([
    'label',
    'list',
    '--json',
    'name',
    '--limit',
    '1000',
    '--repo',
    'owner/repo',
  ]);
});

test('listLabelNames throws ProvisioningError on non-zero exit', async () => {
  const run = presetRunner({ code: 1, stdout: '', stderr: 'error' });
  await expect(listLabelNames(run)).rejects.toBeInstanceOf(ProvisioningError);
});

test('listLabelNames throws ProvisioningError on invalid JSON', async () => {
  const run = presetRunner({ code: 0, stdout: 'not json', stderr: '' });
  await expect(listLabelNames(run)).rejects.toBeInstanceOf(ProvisioningError);
});

test('listLabelNames throws ProvisioningError when JSON is not an array', async () => {
  const run = presetRunner({
    code: 0,
    stdout: '{"name":"C-bugs"}',
    stderr: '',
  });
  await expect(listLabelNames(run)).rejects.toBeInstanceOf(ProvisioningError);
});

test('listLabelNames throws ProvisioningError when an entry has no string name', async () => {
  const run = presetRunner({ code: 0, stdout: '[{"name":42}]', stderr: '' });
  await expect(listLabelNames(run)).rejects.toBeInstanceOf(ProvisioningError);
});

test('createLabel passes correct argv without repo', async () => {
  const sink: { args?: string[] } = {};
  const run = presetRunner({ code: 0, stdout: '', stderr: '' }, sink);
  await createLabel(run, label);
  expect(sink.args).toEqual([
    'label',
    'create',
    'C-bugs',
    '--color',
    'd73a4a',
    '--description',
    "Something isn't working",
  ]);
});

test('createLabel appends --repo when provided', async () => {
  const sink: { args?: string[] } = {};
  const run = presetRunner({ code: 0, stdout: '', stderr: '' }, sink);
  await createLabel(run, label, 'owner/repo');
  expect(sink.args).toEqual([
    'label',
    'create',
    'C-bugs',
    '--color',
    'd73a4a',
    '--description',
    "Something isn't working",
    '--repo',
    'owner/repo',
  ]);
});

test('createLabel throws ProvisioningError on failure', async () => {
  const run = presetRunner({ code: 1, stdout: '', stderr: 'error' });
  await expect(createLabel(run, label)).rejects.toBeInstanceOf(
    ProvisioningError,
  );
});

test('editLabel passes correct argv without repo', async () => {
  const sink: { args?: string[] } = {};
  const run = presetRunner({ code: 0, stdout: '', stderr: '' }, sink);
  await editLabel(run, label);
  expect(sink.args).toEqual([
    'label',
    'edit',
    'C-bugs',
    '--color',
    'd73a4a',
    '--description',
    "Something isn't working",
  ]);
});

test('editLabel appends --repo when provided', async () => {
  const sink: { args?: string[] } = {};
  const run = presetRunner({ code: 0, stdout: '', stderr: '' }, sink);
  await editLabel(run, label, 'owner/repo');
  expect(sink.args).toEqual([
    'label',
    'edit',
    'C-bugs',
    '--color',
    'd73a4a',
    '--description',
    "Something isn't working",
    '--repo',
    'owner/repo',
  ]);
});

test('editLabel throws ProvisioningError on failure', async () => {
  const run = presetRunner({ code: 1, stdout: '', stderr: 'error' });
  await expect(editLabel(run, label)).rejects.toBeInstanceOf(ProvisioningError);
});

test('deleteLabel passes correct argv without repo', async () => {
  const sink: { args?: string[] } = {};
  const run = presetRunner({ code: 0, stdout: '', stderr: '' }, sink);
  await deleteLabel(run, 'C-bugs');
  expect(sink.args).toEqual(['label', 'delete', 'C-bugs', '--yes']);
});

test('deleteLabel appends --repo when provided', async () => {
  const sink: { args?: string[] } = {};
  const run = presetRunner({ code: 0, stdout: '', stderr: '' }, sink);
  await deleteLabel(run, 'C-bugs', 'owner/repo');
  expect(sink.args).toEqual([
    'label',
    'delete',
    'C-bugs',
    '--yes',
    '--repo',
    'owner/repo',
  ]);
});

test('deleteLabel throws ProvisioningError on failure', async () => {
  const run = presetRunner({ code: 1, stdout: '', stderr: 'error' });
  await expect(deleteLabel(run, 'C-bugs')).rejects.toBeInstanceOf(
    ProvisioningError,
  );
});
