import { expect } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  identityFilePath,
  makeIdentity,
  readState,
  saveState,
} from '../../src/identity/store';
import { sandboxedTest } from '../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('identity-');
let counter = 0;

function tempHome(base: string): string {
  counter += 1;
  const dir = join(base, `home-${counter}`);
  mkdirSync(dir);
  return dir;
}

sandboxTest('readState returns null when the file is absent', async (dir) => {
  const path = identityFilePath(tempHome(dir));
  expect(await readState(path)).toBeNull();
});

sandboxTest('saveState then readState round-trips identities', async (dir) => {
  const path = identityFilePath(tempHome(dir));
  const state = {
    personal: makeIdentity('Personal Name', 'personal@example.com'),
    work: makeIdentity('Work Name', 'work@example.com'),
  };
  await saveState(path, state);
  expect(await readState(path)).toEqual(state);
});

sandboxTest(
  'saveState omits null profiles from the serialized file',
  async (dir) => {
    const path = identityFilePath(tempHome(dir));
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

sandboxTest(
  'saveState does not leave atomic temp files behind',
  async (dir) => {
    const path = identityFilePath(tempHome(dir));
    await saveState(path, {
      personal: makeIdentity('Personal', 'p@example.com'),
      work: null,
    });

    const names = await readdir(join(path, '..'));
    expect(names.filter((name) => name.startsWith('.identity.json.'))).toEqual(
      [],
    );
  },
);

sandboxTest(
  'readState parses a pre-existing file in the serialized format',
  async (dir) => {
    // Bytes identical to what saveState writes today, proving the on-disk
    // format is preserved: 2-space JSON, null scopes omitted, trailing newline.
    const path = identityFilePath(tempHome(dir));
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(
      path,
      '{\n  "personal": {\n    "name": "Fixture Person",\n    "email": "fixture@example.com"\n  }\n}\n',
    );

    expect(await readState(path)).toEqual({
      personal: { name: 'Fixture Person', email: 'fixture@example.com' },
      work: null,
    });
  },
);
