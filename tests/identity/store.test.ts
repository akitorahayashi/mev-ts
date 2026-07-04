import { expect, test } from 'bun:test';
import { mkdirSync } from 'node:fs';
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
import { withTemporaryDirectory } from '../fixtures/temporary-directory';

let sandbox = '';
let counter = 0;

function tempHome(): string {
  counter += 1;
  const dir = join(sandbox, `identity-${counter}`);
  mkdirSync(dir);
  return dir;
}

function sandboxTest(name: string, body: () => Promise<void>): void {
  test(name, async () => {
    await withTemporaryDirectory(
      async (dir) => {
        sandbox = dir;
        counter = 0;
        await body();
      },
      { prefix: 'identity-' },
    );
  });
}

sandboxTest('stateExists reflects whether the file is present', async () => {
  const home = tempHome();
  const path = identityFilePath(home);
  expect(stateExists(path)).toBe(false);
  await saveState(path, {
    personal: makeIdentity('P', 'p@x.com'),
    work: null,
  });
  expect(stateExists(path)).toBe(true);
});

sandboxTest('saveState then loadState round-trips identities', async () => {
  const path = identityFilePath(tempHome());
  const state = {
    personal: makeIdentity('Personal Name', 'personal@example.com'),
    work: makeIdentity('Work Name', 'work@example.com'),
  };
  await saveState(path, state);
  expect(await loadState(path)).toEqual(state);
});

sandboxTest(
  'saveState omits null profiles from the serialized file',
  async () => {
    const path = identityFilePath(tempHome());
    await saveState(path, {
      personal: makeIdentity('Only Personal', 'p@example.com'),
      work: null,
    });
    const json = JSON.parse(await readFile(path, 'utf8'));
    expect(json).toEqual({
      personal: { name: 'Only Personal', email: 'p@example.com' },
    });
  },
);

sandboxTest('saveState does not leave atomic temp files behind', async () => {
  const path = identityFilePath(tempHome());
  await saveState(path, {
    personal: makeIdentity('Personal', 'p@example.com'),
    work: null,
  });

  const names = await readdir(join(path, '..'));
  expect(names.filter((name) => name.startsWith('.identity.json.'))).toEqual(
    [],
  );
});

sandboxTest('loadState throws when the file does not exist', async () => {
  const path = identityFilePath(tempHome());
  await expect(loadState(path)).rejects.toBeInstanceOf(AppError);
});
