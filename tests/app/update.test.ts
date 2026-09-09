import { expect } from 'bun:test';
import {
  chmod,
  mkdir,
  readdir,
  readFile,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import {
  requireRegularMevPath,
  runUpdatedSync,
  updateMev,
} from '../../src/app/update';
import { UpdateError } from '../../src/errors';
import { ok } from '../fixtures/fake-command-runner';
import { recordingContext } from '../fixtures/fake-context';
import { stagingSiblings } from '../fixtures/path-probe';
import { sandboxedTest } from '../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('update-');
const RELEASE_BYTES = 'release-binary';
const RELEASE_SHA256 =
  '6a9dd98cb1b85b58ae5df68a8a04fc6a0a8e6fad99c865a3b653a559271abc7c';

interface FakeRelease {
  readonly tag?: string;
  readonly checksum?: string;
  readonly candidateVersion?: string;
  readonly syncCode?: number;
}

function updateContext(home: string, options: FakeRelease = {}) {
  const tag = options.tag ?? 'v0.2.0';
  const checksum = options.checksum ?? RELEASE_SHA256;
  const candidateVersion = options.candidateVersion ?? tag.slice(1);
  let executable = '';
  const recorded = recordingContext({
    home,
    async respond(command, args) {
      if (command === 'uname') return ok('arm64\n');
      if (command === executable && args[0] === 'sync') {
        return { code: options.syncCode ?? 0, stdout: '', stderr: '' };
      }
      if (command === 'curl') {
        const url = args.at(-1) ?? '';
        if (url.endsWith('/releases/latest')) {
          return ok(
            `302\thttps://github.com/akitorahayashi/mev-ts/releases/tag/${tag}`,
          );
        }
        const output = args[args.indexOf('-o') + 1];
        if (!output) throw new Error('curl output missing');
        if (url.endsWith('.sha256')) {
          await writeFile(output, `${checksum}  mev-darwin-arm64\n`);
        } else {
          await writeFile(output, RELEASE_BYTES);
        }
        return ok('200');
      }
      if (command.includes('.mev.')) return ok(`${candidateVersion}\n`);
      throw new Error(`unexpected command: ${command} ${args.join(' ')}`);
    },
  });
  return {
    ...recorded,
    setExecutable(path: string) {
      executable = path;
    },
  };
}

async function installed(home: string, contents = 'old-binary') {
  const bin = join(home, 'bin');
  await mkdir(bin);
  const path = join(bin, 'mev');
  await writeFile(path, contents);
  await chmod(path, 0o755);
  return path;
}

sandboxTest('installs a newer verified release atomically', async (home) => {
  const executablePath = await installed(home);
  const { context, calls } = updateContext(home);

  const outcome = await updateMev({
    currentVersion: '0.1.0',
    executablePath,
    context,
  });

  expect(outcome).toEqual({
    kind: 'updated',
    previousVersion: '0.1.0',
    version: '0.2.0',
    executablePath,
  });
  expect(await readFile(executablePath, 'utf8')).toBe(RELEASE_BYTES);
  expect((await stat(executablePath)).mode & 0o777).toBe(0o755);
  expect(await stagingSiblings(executablePath)).toEqual([]);
  expect(
    (await readdir(home)).filter((name) => name.startsWith('mev-update-')),
  ).toEqual([]);
  expect(
    calls.some(
      ({ command, args }) =>
        command === 'curl' && args.at(-1)?.endsWith('/mev-darwin-arm64'),
    ),
  ).toBe(true);
});

sandboxTest(
  'same version and checksum skips the binary download',
  async (home) => {
    const executablePath = await installed(home, RELEASE_BYTES);
    const { context, calls } = updateContext(home);

    const outcome = await updateMev({
      currentVersion: '0.2.0',
      executablePath,
      context,
    });

    expect(outcome.kind).toBe('current');
    expect(
      calls.some(
        ({ command, args }) =>
          command === 'curl' && args.at(-1)?.endsWith('/mev-darwin-arm64'),
      ),
    ).toBe(false);
  },
);

sandboxTest(
  'same version with different bytes reinstalls the release',
  async (home) => {
    const executablePath = await installed(home);
    const { context } = updateContext(home);

    const outcome = await updateMev({
      currentVersion: '0.2.0',
      executablePath,
      context,
    });

    expect(outcome.kind).toBe('reinstalled');
    expect(await readFile(executablePath, 'utf8')).toBe(RELEASE_BYTES);
  },
);

sandboxTest(
  'a checksum mismatch preserves the installed command',
  async (home) => {
    const executablePath = await installed(home);
    const { context } = updateContext(home, { checksum: '0'.repeat(64) });

    await expect(
      updateMev({ currentVersion: '0.1.0', executablePath, context }),
    ).rejects.toBeInstanceOf(UpdateError);

    expect(await readFile(executablePath, 'utf8')).toBe('old-binary');
    expect(await stagingSiblings(executablePath)).toEqual([]);
  },
);

sandboxTest(
  'a candidate version mismatch preserves the installed command',
  async (home) => {
    const executablePath = await installed(home);
    const { context } = updateContext(home, { candidateVersion: '0.1.0' });

    await expect(
      updateMev({ currentVersion: '0.1.0', executablePath, context }),
    ).rejects.toThrow("reports version '0.1.0', expected '0.2.0'");
    expect(await readFile(executablePath, 'utf8')).toBe('old-binary');
  },
);

sandboxTest(
  'a newer local command is not downgraded or downloaded',
  async (home) => {
    const executablePath = await installed(home);
    const { context, calls } = updateContext(home);

    const outcome = await updateMev({
      currentVersion: '0.3.0',
      executablePath,
      context,
    });

    expect(outcome).toMatchObject({
      kind: 'ahead',
      version: '0.3.0',
      latestVersion: '0.2.0',
    });
    expect(calls.some(({ args }) => args.at(-1)?.endsWith('.sha256'))).toBe(
      false,
    );
  },
);

sandboxTest(
  'sync runs from the exact installed path and forwards upgrade',
  async (home) => {
    const executablePath = await installed(home);
    const fake = updateContext(home, { syncCode: 1 });
    fake.setExecutable(executablePath);

    const code = await runUpdatedSync(
      fake.context.commands,
      executablePath,
      true,
    );

    expect(code).toBe(1);
    expect(fake.calls.at(-1)).toEqual({
      command: executablePath,
      args: ['sync', '--upgrade'],
      options: { stdout: 'inherit', stderr: 'inherit' },
    });
  },
);

sandboxTest('an installed-command symlink is rejected', async (home) => {
  const target = await installed(home);
  const path = join(home, 'mev-link');
  await symlink(target, path);

  await expect(requireRegularMevPath(path)).rejects.toThrow(
    'is not a regular file',
  );
});

sandboxTest(
  'a sync launch failure is reported as an update error',
  async (home) => {
    const executablePath = await installed(home);
    const fake = updateContext(home, { syncCode: 127 });
    fake.setExecutable(executablePath);

    await expect(
      runUpdatedSync(fake.context.commands, executablePath, false),
    ).rejects.toBeInstanceOf(UpdateError);
  },
);
