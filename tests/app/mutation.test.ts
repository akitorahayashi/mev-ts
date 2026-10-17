import { expect } from 'bun:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { configSelect, configSelectClear } from '../../src/app/coder';
import {
  pinIdentity,
  setIdentity,
  showIdentity,
  switchIdentity,
  unpinIdentity,
} from '../../src/app/identity';
import { configureSshHost } from '../../src/app/ssh-host';
import { updateMev } from '../../src/app/update';
import {
  configSelectZedOverrides,
  configSelectZedOverridesClear,
} from '../../src/app/zed';
import { runSet } from '../../src/cli/commands/user';
import { acquireMutationLease } from '../../src/host/mutation-lease';
import { allScopes } from '../../src/identity/scope';
import { identityFilePath } from '../../src/identity/store';
import { appliedPath } from '../../src/provisioning/applied';
import { recordingContext } from '../fixtures/fake-context';
import { runCliInSandbox } from '../fixtures/sandboxed-cli';
import { sandboxedTest } from '../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('app-mutation-');

sandboxTest(
  'mutating entry points reject before reading invalid state or issuing host commands',
  async (home) => {
    const { context, calls } = recordingContext({ home });
    const identityDeps = { home, run: context.commands, cwd: home };
    const scope = allScopes()[0];
    if (!scope) throw new Error('identity scope required');
    const inputs = Object.fromEntries(
      allScopes().map((name) => [
        name,
        { name: 'Name', email: 'email@example.test' },
      ]),
    );
    await mkdir(join(home, '.mev/applied'), { recursive: true });
    await writeFile(appliedPath(home, 'coder'), 'retained marker');
    await writeFile(identityFilePath(home), 'invalid identity metadata');
    const lease = await acquireMutationLease(home, 'running provisioning');
    let prompted = false;
    try {
      const operations = [
        () =>
          configSelect(
            'agents',
            home,
            () => {},
            async () => {
              prompted = true;
              return [];
            },
          ),
        () => configSelectClear('skills', home),
        () =>
          configSelectZedOverrides(
            home,
            () => {},
            async () => {
              prompted = true;
              return [];
            },
          ),
        () => configSelectZedOverridesClear(home),
        () => configureSshHost(home, 'github-personal'),
        () =>
          setIdentity({ home }, inputs as Parameters<typeof setIdentity>[1]),
        () =>
          runSet(
            home,
            () => {},
            async () => {
              prompted = true;
              throw new Error('prompt must not start');
            },
          ),
        () => switchIdentity(identityDeps, scope),
        () => pinIdentity(identityDeps, scope),
        () => unpinIdentity(identityDeps),
        () =>
          updateMev({
            currentVersion: '0.3.0',
            executablePath: join(home, 'mev'),
            context,
          }),
      ];
      for (const operation of operations)
        await expect(operation()).rejects.toThrow('running provisioning');
      expect(prompted).toBe(false);
      expect(calls).toEqual([]);
      expect(await readFile(appliedPath(home, 'coder'), 'utf8')).toBe(
        'retained marker',
      );
      expect(await readFile(identityFilePath(home), 'utf8')).toBe(
        'invalid identity metadata',
      );
      for (const args of [['make', 'coder'], ['create'], ['sync']]) {
        const result = await runCliInSandbox(args, home);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain('running provisioning');
        expect(result.stderr).not.toContain('could not scan');
      }
    } finally {
      await lease.release();
    }
  },
);

sandboxTest(
  'interactive identity reads and persistence share one lease, while read-only commands stay independent',
  async (home) => {
    let prompted = false;
    await runSet(
      home,
      () => {},
      async (collect) =>
        collect({
          async ask() {
            prompted = true;
            await expect(
              acquireMutationLease(home, 'competing writer'),
            ).rejects.toThrow('user set');
            return '';
          },
        }),
    );
    expect(prompted).toBe(true);
    const lease = await acquireMutationLease(home, 'running provisioning');
    try {
      const { context } = recordingContext({ home });
      expect(
        (await showIdentity({ home, cwd: home, run: context.commands })).path,
      ).toBe(identityFilePath(home));
      const result = await runCliInSandbox(['list'], home);
      expect(result.code).toBe(0);
      expect(result.stderr).toBe('');
    } finally {
      await lease.release();
    }
  },
);
