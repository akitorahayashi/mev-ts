import { expect } from 'bun:test';
import {
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  rename,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { withHomeMutation } from '../../src/app/mutation';
import { acquireMutationLease } from '../../src/host/mutation-lease';
import { withSwapTransaction } from '../../src/host/transaction';
import { transactionRecordsRoot } from '../../src/host/transaction-record';
import { appliedPath, readApplied } from '../../src/provisioning/applied';
import { interruptSwap as interrupt } from '../fixtures/interrupted-swap';
import { sandboxedTest } from '../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('transaction-recovery-');

for (const boundary of [
  'prepared',
  'backed-up',
  'replaced',
  'published',
] as const) {
  sandboxTest(
    `file-to-directory replacement recovers after ${boundary}`,
    async (home) => {
      const dest = join(home, 'managed/resource');
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, 'old file');
      await interrupt(home, boundary);
      await withHomeMutation(home, 'recover replacement', async () => {
        if (boundary === 'prepared' || boundary === 'backed-up')
          expect(await readFile(dest, 'utf8')).toBe('old file');
        else
          expect(await readFile(join(dest, 'new.txt'), 'utf8')).toBe(
            'new contents',
          );
      });
    },
  );
}

for (const edit of ['added', 'changed']) {
  sandboxTest(
    `partial-cleanup ownership rejects externally ${edit} backup content`,
    async (home) => {
      await oldDirectory(home);
      const paths = await interrupt(home, 'published');
      const [file] = await records(home);
      if (!file) throw new Error('Expected journal');
      const record = JSON.parse(await readFile(file, 'utf8'));
      await writeFile(
        file,
        JSON.stringify({ ...record, state: 'cleanup-new' }),
      );
      const external = join(
        paths.backup,
        edit === 'added' ? 'external.txt' : 'old.txt',
      );
      await writeFile(external, 'external contents');
      await expect(
        withHomeMutation(home, 'recover cleanup', async () => {}),
      ).rejects.toThrow('external changes');
      expect(await readFile(external, 'utf8')).toBe('external contents');
    },
  );
}

sandboxTest(
  'rewriting otherwise valid journal ownership fields is detected by the stage anchor',
  async (home) => {
    await oldDirectory(home);
    const paths = await interrupt(home, 'backed-up');
    const [file] = await records(home);
    if (!file) throw new Error('Expected journal');
    const record = JSON.parse(await readFile(file, 'utf8'));
    await writeFile(file, JSON.stringify({ ...record, strategy: 'atomic' }));
    await expect(
      withHomeMutation(home, 'recover altered record', async () => {}),
    ).rejects.toThrow('ownership marker changed');
    expect(await readFile(join(paths.backup, 'old.txt'), 'utf8')).toBe(
      'old contents',
    );
  },
);

sandboxTest(
  'an incomplete pending journal update is preserved without guessing its intent',
  async (home) => {
    await oldDirectory(home);
    const paths = await interrupt(home, 'replaced');
    const [file] = await records(home);
    if (!file) throw new Error('Expected journal');
    await writeFile(`${file}.pending`, '{incomplete');
    await expect(
      withHomeMutation(home, 'recover partial journal', async () => {}),
    ).rejects.toThrow('recovery refused');
    expect(await readFile(`${file}.pending`, 'utf8')).toBe('{incomplete');
    expect(await readFile(join(paths.backup, 'old.txt'), 'utf8')).toBe(
      'old contents',
    );
    expect(await readFile(join(paths.dest, 'new.txt'), 'utf8')).toBe(
      'new contents',
    );
  },
);

sandboxTest(
  'a failed in-process rollback retains its journal and backup for the next invocation',
  async (home) => {
    const dest = await oldDirectory(home);
    try {
      await expect(
        withHomeMutation(home, 'failed rollback', () =>
          withSwapTransaction(
            dest,
            'directory',
            async ({ staged, install }) => {
              await mkdir(staged);
              await writeFile(join(staged, 'new.txt'), 'new contents');
              await install();
            },
            {
              home,
              async onBoundary(phase) {
                if (phase === 'backed-up') {
                  await chmod(dirname(dest), 0o500);
                  throw new Error('replacement failed');
                }
              },
            },
          ),
        ),
      ).rejects.toBeInstanceOf(AggregateError);
      await absent(dest);
      expect(await records(home)).toHaveLength(1);
    } finally {
      await chmod(dirname(dest), 0o700);
    }
    await withHomeMutation(home, 'recover failed rollback', async () => {
      expect(await readFile(join(dest, 'old.txt'), 'utf8')).toBe(
        'old contents',
      );
    });
  },
);

sandboxTest(
  'backup cleanup never follows a symlink into unrelated personal state',
  async (directory) => {
    const home = join(directory, 'home');
    const personal = join(directory, 'personal');
    await mkdir(home);
    await mkdir(personal);
    await writeFile(join(personal, 'keep'), 'personal contents');
    const dest = await oldDirectory(home);
    await symlink(personal, join(dest, 'external-link'));
    await interrupt(home, 'published');
    await withHomeMutation(
      home,
      'recover symlink-containing backup',
      async () => {},
    );
    expect(await readFile(join(personal, 'keep'), 'utf8')).toBe(
      'personal contents',
    );
  },
);
async function oldDirectory(home: string): Promise<string> {
  const dest = join(home, 'managed/resource');
  await mkdir(dest, { recursive: true });
  await writeFile(join(dest, 'old.txt'), 'old contents');
  return dest;
}

async function records(home: string): Promise<string[]> {
  return (await readdir(transactionRecordsRoot(home))).map((name) =>
    join(transactionRecordsRoot(home), name),
  );
}

async function absent(path: string): Promise<void> {
  await expect(lstat(path)).rejects.toHaveProperty('code', 'ENOENT');
}

for (const boundary of [
  'prepared',
  'backed-up',
  'replaced',
  'published',
] as const) {
  sandboxTest(
    `restart after ${boundary} proves and retains the correct directory`,
    async (home) => {
      const dest = await oldDirectory(home);
      const paths = await interrupt(home, boundary);
      const previous = boundary === 'prepared' || boundary === 'backed-up';
      await withHomeMutation(home, 'next mutation', async () => {
        expect(
          await readFile(join(dest, previous ? 'old.txt' : 'new.txt'), 'utf8'),
        ).toBe(previous ? 'old contents' : 'new contents');
        await absent(join(dest, previous ? 'new.txt' : 'old.txt'));
        expect(await records(home)).toEqual([]);
      });
      const before = await lstat(dest);
      await withHomeMutation(home, 'idempotent recovery', async () => {});
      expect((await lstat(dest)).ino).toBe(before.ino);
      await absent(paths.backup);
      await absent(paths.staged);
    },
  );

  sandboxTest(
    `restart after ${boundary} safely handles a directory-to-symlink replacement`,
    async (home) => {
      const dest = await oldDirectory(home);
      await writeFile(join(home, 'link-target'), 'linked contents');
      await interrupt(home, boundary, 'symlink');
      await withHomeMutation(home, 'next mutation', async () => {
        if (boundary === 'prepared' || boundary === 'backed-up')
          expect(await readFile(join(dest, 'old.txt'), 'utf8')).toBe(
            'old contents',
          );
        else {
          expect(await readlink(dest)).toBe(join(home, 'link-target'));
          expect(await readFile(dest, 'utf8')).toBe('linked contents');
        }
      });
    },
  );
}

for (const boundary of ['prepared', 'replaced', 'published'] as const) {
  sandboxTest(
    `an originally absent destination is recovered correctly after ${boundary}`,
    async (home) => {
      const paths = await interrupt(home, boundary);
      await withHomeMutation(home, 'next mutation', async () => {
        if (boundary === 'prepared') await absent(paths.dest);
        else
          expect(await readFile(join(paths.dest, 'new.txt'), 'utf8')).toBe(
            'new contents',
          );
      });
      expect(await records(home)).toEqual([]);
    },
  );
}

for (const changed of ['backup', 'staged', 'dest'] as const) {
  sandboxTest(
    `external ${changed} edits are retained without authorizing any subsequent mutation`,
    async (home) => {
      await oldDirectory(home);
      const boundary =
        changed === 'backup'
          ? 'backed-up'
          : changed === 'dest'
            ? 'replaced'
            : 'prepared';
      const paths = await interrupt(home, boundary);
      const file = join(
        paths[changed],
        changed === 'backup' ? 'old.txt' : 'new.txt',
      );
      await writeFile(file, 'external edit');
      const before = await records(home);
      let ran = false;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await expect(
          withHomeMutation(home, 'must not run', async () => {
            ran = true;
          }),
        ).rejects.toThrow('Transaction recovery refused');
        expect(await readFile(file, 'utf8')).toBe('external edit');
        expect(await records(home)).toEqual(before);
      }
      expect(ran).toBe(false);
    },
  );
}

sandboxTest(
  'matching bytes in a replaced stage inode do not establish transaction ownership',
  async (home) => {
    await oldDirectory(home);
    const paths = await interrupt(home, 'prepared');
    const retained = `${paths.staged}-retained`;
    await rename(paths.staged, retained);
    await mkdir(paths.staged);
    await writeFile(join(paths.staged, 'new.txt'), 'new contents');
    await expect(
      withHomeMutation(home, 'next mutation', async () => {}),
    ).rejects.toThrow('recovery refused');
    expect(await readFile(join(retained, 'new.txt'), 'utf8')).toBe(
      'new contents',
    );
    expect(await readFile(join(paths.dest, 'old.txt'), 'utf8')).toBe(
      'old contents',
    );
  },
);

sandboxTest(
  'failed restoration retains the backup and succeeds after the filesystem restriction is removed',
  async (home) => {
    await oldDirectory(home);
    const paths = await interrupt(home, 'backed-up');
    await chmod(dirname(paths.dest), 0o500);
    try {
      await expect(
        withHomeMutation(home, 'next mutation', async () => {}),
      ).rejects.toThrow('recovery refused');
      expect(await readFile(join(paths.backup, 'old.txt'), 'utf8')).toBe(
        'old contents',
      );
      await absent(paths.dest);
      expect(await records(home)).toHaveLength(1);
    } finally {
      await chmod(dirname(paths.dest), 0o700);
    }
    await withHomeMutation(home, 'restored permission', async () => {
      expect(await readFile(join(paths.dest, 'old.txt'), 'utf8')).toBe(
        'old contents',
      );
    });
  },
);

sandboxTest(
  'partially completed owned cleanup is resumable without accepting added or edited content',
  async (home) => {
    await oldDirectory(home);
    const paths = await interrupt(home, 'published');
    const [file] = await records(home);
    if (!file) throw new Error('Expected a recovery record');
    const record = JSON.parse(await readFile(file, 'utf8'));
    await writeFile(file, JSON.stringify({ ...record, state: 'cleanup-new' }));
    await unlink(join(paths.backup, 'old.txt'));
    await withHomeMutation(home, 'resume cleanup', async () => {
      expect(await readFile(join(paths.dest, 'new.txt'), 'utf8')).toBe(
        'new contents',
      );
    });
    expect(await records(home)).toEqual([]);
  },
);

sandboxTest(
  'a valid pending publication journal update is reconciled with rename evidence',
  async (home) => {
    await oldDirectory(home);
    const paths = await interrupt(home, 'replaced');
    const [file] = await records(home);
    if (!file) throw new Error('Expected a recovery record');
    const record = JSON.parse(await readFile(file, 'utf8'));
    await writeFile(
      `${file}.pending`,
      JSON.stringify({ ...record, state: 'published' }),
    );
    await withHomeMutation(home, 'complete publication', async () => {
      expect(await readFile(join(paths.dest, 'new.txt'), 'utf8')).toBe(
        'new contents',
      );
    });
    expect(await records(home)).toEqual([]);
  },
);

sandboxTest(
  'recovery never manufactures successful application markers',
  async (home) => {
    const dest = join(home, '.mev/roles/git');
    await mkdir(dest, { recursive: true });
    await writeFile(join(dest, 'old.txt'), 'old contents');
    await interrupt(home, 'replaced', 'directory', dest);
    await withHomeMutation(home, 'reevaluate interrupted target', async () => {
      expect(await readApplied(appliedPath(home, 'git'))).toBeNull();
      expect(await readFile(join(dest, 'new.txt'), 'utf8')).toBe(
        'new contents',
      );
    });
  },
);

sandboxTest(
  'legacy artifacts and unrecognized journal contents are retained rather than pruned',
  async (home) => {
    const legacy = join(home, '.mev/roles/obsolete/.resource.abcdef');
    await mkdir(join(legacy, 'backup'), { recursive: true });
    await writeFile(join(legacy, 'backup/keep'), 'legacy contents');
    await expect(
      withHomeMutation(home, 'prune', async () => {}),
    ).rejects.toThrow('Unrecorded transaction artifact');
    expect(await readFile(join(legacy, 'backup/keep'), 'utf8')).toBe(
      'legacy contents',
    );
    const otherHome = join(home, 'other-home');
    const root = transactionRecordsRoot(otherHome);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'unknown.json'), 'unknown state');
    await expect(
      withHomeMutation(otherHome, 'next mutation', async () => {}),
    ).rejects.toThrow('unrecognized or incomplete recovery record');
    expect(await readFile(join(root, 'unknown.json'), 'utf8')).toBe(
      'unknown state',
    );
  },
);

sandboxTest(
  'recovery cannot run before exclusive ownership has been established',
  async (home) => {
    await oldDirectory(home);
    const paths = await interrupt(home, 'backed-up');
    const lease = await acquireMutationLease(home, 'blocking operation');
    try {
      await expect(
        withHomeMutation(home, 'next mutation', async () => {}),
      ).rejects.toThrow('blocking operation');
      await absent(paths.dest);
      expect(await readFile(join(paths.backup, 'old.txt'), 'utf8')).toBe(
        'old contents',
      );
    } finally {
      await lease.release();
    }
    await withHomeMutation(home, 'next mutation', async () => {});
  },
);

sandboxTest(
  'in-process publication failure restores the previous state and removes its completed journal',
  async (home) => {
    const dest = await oldDirectory(home);
    const failure = new Error('injected failure before replacement');
    await expect(
      withHomeMutation(home, 'rollback', () =>
        withSwapTransaction(
          dest,
          'directory',
          async ({ staged, install }) => {
            await mkdir(staged);
            await writeFile(join(staged, 'new.txt'), 'new contents');
            await install();
          },
          {
            home,
            async onBoundary(phase) {
              if (phase === 'backed-up') throw failure;
            },
          },
        ),
      ),
    ).rejects.toBe(failure);
    expect(await readFile(join(dest, 'old.txt'), 'utf8')).toBe('old contents');
    expect(await records(home)).toEqual([]);
  },
);
