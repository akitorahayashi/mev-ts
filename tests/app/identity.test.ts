import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  setIdentity,
  showIdentity,
  switchIdentity,
} from '../../src/app/identity';
import { CommandLineError } from '../../src/errors';
import type { CommandResult, CommandRunner } from '../../src/host/command';
import {
  identityFilePath,
  loadState,
  makeIdentity,
  saveState,
} from '../../src/identity/store';

const roots: string[] = [];

function tempHome(): string {
  const dir = mkdtempSync(join('.tmp', 'identity-app-'));
  roots.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

/** Runner that answers `git config --global --get <key>` from a map and
 * records every `git config --global <key> <value>` write. */
function gitRunner(
  globals: Record<string, string>,
  writes: { key: string; value: string }[] = [],
): CommandRunner {
  return {
    async run(_command, args): Promise<CommandResult> {
      const rest = [...args];
      if (
        rest[0] === 'config' &&
        rest[1] === '--global' &&
        rest[2] === '--get'
      ) {
        const value = globals[rest[3] ?? ''];
        return value === undefined
          ? { code: 1, stdout: '', stderr: '' }
          : { code: 0, stdout: `${value}\n`, stderr: '' };
      }
      if (rest[0] === 'config' && rest[1] === '--global') {
        writes.push({ key: rest[2] ?? '', value: rest[3] ?? '' });
        return { code: 0, stdout: '', stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    },
  };
}

async function seed(home: string): Promise<void> {
  await saveState(identityFilePath(home), {
    personal: makeIdentity('Personal Name', 'personal@example.com'),
    work: makeIdentity('Work Name', 'work@example.com'),
  });
}

test('showIdentity marks the active scope when git matches a profile', async () => {
  const home = tempHome();
  await seed(home);
  const run = gitRunner({
    'user.name': 'Work Name',
    'user.email': 'work@example.com',
  });

  const view = await showIdentity({ run, home });

  expect(view.personal?.email).toBe('personal@example.com');
  expect(view.current).toEqual({
    kind: 'matched',
    scope: 'work',
    identity: { name: 'Work Name', email: 'work@example.com' },
  });
});

test('showIdentity reports unmanaged when git matches no profile', async () => {
  const home = tempHome();
  await seed(home);
  const run = gitRunner({
    'user.name': 'Someone Else',
    'user.email': 'other@example.com',
  });

  const view = await showIdentity({ run, home });
  expect(view.current.kind).toBe('unmanaged');
});

test('showIdentity reports unset when git has no identity', async () => {
  const home = tempHome();
  await seed(home);
  const run = gitRunner({});

  const view = await showIdentity({ run, home });
  expect(view.current.kind).toBe('unset');
});

test('showIdentity surfaces a half-configured identity as unmanaged', async () => {
  const home = tempHome();
  await seed(home);
  const run = gitRunner({ 'user.name': 'Solo Name' });

  const view = await showIdentity({ run, home });
  expect(view.current).toEqual({
    kind: 'unmanaged',
    identity: { name: 'Solo Name', email: '' },
  });
});

test('showIdentity throws when no configuration exists', async () => {
  const run = gitRunner({});
  await expect(showIdentity({ run, home: tempHome() })).rejects.toBeInstanceOf(
    CommandLineError,
  );
});

test('switchIdentity applies the stored identity to global git config', async () => {
  const home = tempHome();
  await seed(home);
  const writes: { key: string; value: string }[] = [];
  const run = gitRunner({}, writes);

  const applied = await switchIdentity({ run, home }, 'personal');

  expect(applied).toEqual({
    name: 'Personal Name',
    email: 'personal@example.com',
  });
  expect(writes).toEqual([
    { key: 'user.name', value: 'Personal Name' },
    { key: 'user.email', value: 'personal@example.com' },
  ]);
});

test('switchIdentity throws when no configuration exists', async () => {
  const run = gitRunner({});
  await expect(
    switchIdentity({ run, home: tempHome() }, 'work'),
  ).rejects.toBeInstanceOf(CommandLineError);
});

test('switchIdentity throws when the requested scope is unconfigured', async () => {
  const home = tempHome();
  await saveState(identityFilePath(home), {
    personal: makeIdentity('Personal Name', 'personal@example.com'),
    work: null,
  });
  const run = gitRunner({});
  await expect(switchIdentity({ run, home }, 'work')).rejects.toBeInstanceOf(
    CommandLineError,
  );
});

test('setIdentity persists collected inputs and drops blank profiles', async () => {
  const home = tempHome();
  const { path, state } = await setIdentity(
    { home },
    {
      personal: { name: 'Jane', email: 'jane@example.com' },
      work: { name: '', email: '' },
    },
  );

  expect(state.work).toBeNull();
  expect(await loadState(path)).toEqual({
    personal: { name: 'Jane', email: 'jane@example.com' },
    work: null,
  });
});
