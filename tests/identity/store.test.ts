import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AppError } from '../../src/errors';
import {
  identityFilePath,
  loadState,
  makeIdentity,
  saveState,
  stateExists,
} from '../../src/identity/store';

const roots: string[] = [];

function tempHome(): string {
  mkdirSync('.tmp', { recursive: true });
  const dir = mkdtempSync(join('.tmp', 'identity-'));
  roots.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

test('stateExists reflects whether the file is present', async () => {
  const home = tempHome();
  const path = identityFilePath(home);
  expect(stateExists(path)).toBe(false);
  await saveState(path, {
    personal: makeIdentity('P', 'p@x.com'),
    work: null,
  });
  expect(stateExists(path)).toBe(true);
});

test('saveState then loadState round-trips identities', async () => {
  const path = identityFilePath(tempHome());
  const state = {
    personal: makeIdentity('Personal Name', 'personal@example.com'),
    work: makeIdentity('Work Name', 'work@example.com'),
  };
  await saveState(path, state);
  expect(await loadState(path)).toEqual(state);
});

test('saveState omits null profiles from the serialized file', async () => {
  const path = identityFilePath(tempHome());
  await saveState(path, {
    personal: makeIdentity('Only Personal', 'p@example.com'),
    work: null,
  });
  const json = JSON.parse(await readFile(path, 'utf8'));
  expect(json).toEqual({
    personal: { name: 'Only Personal', email: 'p@example.com' },
  });
});

test('saveState does not leave the former fixed temp file behind', async () => {
  const path = identityFilePath(tempHome());
  await saveState(path, {
    personal: makeIdentity('Personal', 'p@example.com'),
    work: null,
  });

  const names = await readdir(join(path, '..'));
  expect(names).not.toContain('.identity.json.tmp');
});

test('loadState throws when the file does not exist', async () => {
  const path = identityFilePath(tempHome());
  await expect(loadState(path)).rejects.toBeInstanceOf(AppError);
});
