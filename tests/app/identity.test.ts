import { expect, test } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  setIdentity,
  showIdentity,
  switchIdentity,
} from '../../src/app/identity';
import { AppError } from '../../src/errors';
import type { CommandResult, CommandRunner } from '../../src/host/command';
import {
  identityFilePath,
  makeIdentity,
  readState,
  saveState,
} from '../../src/identity/store';
import { withTemporaryDirectory } from '../fixtures/temporary-directory';

let sandbox = '';
let counter = 0;

function tempHome(): string {
  counter += 1;
  const dir = join(sandbox, `identity-app-${counter}`);
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
      { prefix: 'identity-app-' },
    );
  });
}

/** Runner that answers global reads from a map and records explicit-file writes. */
function gitRunner(
  globals: Record<string, string>,
  writes: { path: string; key: string; value: string }[] = [],
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
      if (rest[0] === 'config' && rest[1] === '--file') {
        writes.push({
          path: rest[2] ?? '',
          key: rest[3] ?? '',
          value: rest[4] ?? '',
        });
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

sandboxTest(
  'showIdentity marks the active scope when git matches a profile',
  async () => {
    const home = tempHome();
    await seed(home);
    const run = gitRunner({
      'user.name': 'Work Name',
      'user.email': 'work@example.com',
    });

    const view = await showIdentity({ run, home });

    expect(view.identities.personal?.email).toBe('personal@example.com');
    expect(view.current).toEqual({
      kind: 'matched',
      scope: 'work',
      identity: { name: 'Work Name', email: 'work@example.com' },
    });
  },
);

sandboxTest(
  'showIdentity reports unmanaged when git matches no profile',
  async () => {
    const home = tempHome();
    await seed(home);
    const run = gitRunner({
      'user.name': 'Someone Else',
      'user.email': 'other@example.com',
    });

    const view = await showIdentity({ run, home });
    expect(view.current.kind).toBe('unmanaged');
  },
);

sandboxTest('showIdentity reports unset when git has no identity', async () => {
  const home = tempHome();
  await seed(home);
  const run = gitRunner({});

  const view = await showIdentity({ run, home });
  expect(view.current.kind).toBe('unset');
});

sandboxTest(
  'showIdentity surfaces a half-configured identity as unmanaged',
  async () => {
    const home = tempHome();
    await seed(home);
    const run = gitRunner({ 'user.name': 'Solo Name' });

    const view = await showIdentity({ run, home });
    expect(view.current).toEqual({
      kind: 'unmanaged',
      identity: { name: 'Solo Name', email: '' },
    });
  },
);

sandboxTest('showIdentity throws when no configuration exists', async () => {
  const run = gitRunner({});
  await expect(showIdentity({ run, home: tempHome() })).rejects.toBeInstanceOf(
    AppError,
  );
});

sandboxTest(
  'switchIdentity applies the stored identity to global git config',
  async () => {
    const home = tempHome();
    await seed(home);
    const writes: { path: string; key: string; value: string }[] = [];
    const run = gitRunner({}, writes);

    const applied = await switchIdentity({ run, home }, 'personal');

    expect(applied).toEqual({
      name: 'Personal Name',
      email: 'personal@example.com',
    });
    expect(writes.map(({ key, value }) => ({ key, value }))).toEqual([
      { key: 'user.name', value: 'Personal Name' },
      { key: 'user.email', value: 'personal@example.com' },
    ]);
    expect(writes[0]?.path).toBe(writes[1]?.path);
    expect(writes[0]?.path).not.toBe(join(home, '.gitconfig'));
  },
);

sandboxTest('switchIdentity throws when no configuration exists', async () => {
  const run = gitRunner({});
  await expect(
    switchIdentity({ run, home: tempHome() }, 'work'),
  ).rejects.toBeInstanceOf(AppError);
});

sandboxTest(
  'switchIdentity throws when the requested scope is unconfigured',
  async () => {
    const home = tempHome();
    await saveState(identityFilePath(home), {
      personal: makeIdentity('Personal Name', 'personal@example.com'),
      work: null,
    });
    const run = gitRunner({});
    await expect(switchIdentity({ run, home }, 'work')).rejects.toBeInstanceOf(
      AppError,
    );
  },
);

sandboxTest(
  'setIdentity persists collected inputs and drops blank profiles',
  async () => {
    const home = tempHome();
    const { path, state } = await setIdentity(
      { home },
      {
        personal: { name: 'Jane', email: 'jane@example.com' },
        work: { name: '', email: '' },
      },
    );

    expect(state.work).toBeNull();
    expect(await readState(path)).toEqual({
      personal: { name: 'Jane', email: 'jane@example.com' },
      work: null,
    });
  },
);

sandboxTest(
  'setIdentity rejects a scope with only one field filled',
  async () => {
    const home = tempHome();
    await expect(
      setIdentity(
        { home },
        {
          personal: { name: 'Jane', email: '' },
          work: { name: '', email: '' },
        },
      ),
    ).rejects.toBeInstanceOf(AppError);
    // Nothing is written when validation fails.
    expect(await readState(identityFilePath(home))).toBeNull();
  },
);
