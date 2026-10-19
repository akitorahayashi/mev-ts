import { expect, spyOn } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { withHomeMutation } from '../../src/app/mutation';
import {
  acquireMutationLease,
  mutationLeasePath,
} from '../../src/host/mutation-lease';
import { sandboxedTest } from '../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('mutation-lease-');
const leaseModule = resolve('src/host/mutation-lease.ts');

// A real process is necessary to establish independent ownership and death.
async function startOwner(home: string) {
  const child = Bun.spawn(
    [
      process.execPath,
      '-e',
      `
    import { acquireMutationLease } from ${JSON.stringify(leaseModule)};
    const lease = await acquireMutationLease(process.env.MEV_TEST_LEASE_HOME, 'child provisioning');
    console.log('ready');
    await Bun.stdin.text();
    await lease.release();
  `,
    ],
    {
      env: { ...Bun.env, MEV_TEST_LEASE_HOME: home },
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const reader = child.stdout.getReader();
  const ready = await reader.read();
  if (new TextDecoder().decode(ready.value).trim() !== 'ready') {
    throw new Error(
      `Lease child did not become ready: ${await new Response(child.stderr).text()}`,
    );
  }
  reader.releaseLock();
  return child;
}

sandboxTest(
  'independent processes reject immediately before conflicting writes and release normally',
  async (home) => {
    const child = await startOwner(home);
    try {
      let wrote = false;
      await expect(
        withHomeMutation(home, 'competing config', async () => {
          wrote = true;
        }),
      ).rejects.toThrow("'child provisioning'");
      expect(wrote).toBe(false);
      child.stdin.end();
      expect(await child.exited).toBe(0);
      const lease = await acquireMutationLease(home, 'next operation');
      await lease.release();
      expect(await readdir(join(home, '.mev'))).toEqual([]);
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL');
      await child.exited;
    }
  },
);

for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
  sandboxTest(
    `${signal} leaves a provably ended owner that the next operation reclaims`,
    async (home) => {
      const child = await startOwner(home);
      child.kill(signal);
      await child.exited;
      const results = await Promise.allSettled([
        acquireMutationLease(home, 'first successor'),
        acquireMutationLease(home, 'second successor'),
      ]);
      const winners = results.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : [],
      );
      expect(winners).toHaveLength(1);
      for (const winner of winners) await winner.release();
      expect(await readdir(join(home, '.mev'))).toEqual([]);
    },
  );
}

sandboxTest(
  'different homes are independent and aliases of the same home contend',
  async (directory) => {
    const first = join(directory, 'first');
    const other = join(directory, 'other');
    const alias = join(directory, 'alias');
    await mkdir(first);
    await mkdir(other);
    await symlink(first, alias);
    const lease = await acquireMutationLease(first, 'first home');
    const independent = await acquireMutationLease(other, 'other home');
    try {
      await expect(acquireMutationLease(alias, 'aliased home')).rejects.toThrow(
        'first home',
      );
    } finally {
      await independent.release();
      await lease.release();
    }
  },
);

sandboxTest(
  'normal and exceptional application completion both release the owned lease',
  async (home) => {
    expect(await withHomeMutation(home, 'success', async () => 42)).toBe(42);
    const failure = new Error('action failed');
    await expect(
      withHomeMutation(home, 'failure', async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(
      await withHomeMutation(home, 'after failure', async () => 'available'),
    ).toBe('available');
  },
);

for (const metadata of [
  undefined,
  '{}',
  '{invalid',
  JSON.stringify({
    version: 1,
    host: hostname(),
    pid: process.pid,
    token: randomUUID(),
  }),
]) {
  sandboxTest(
    `incomplete owner metadata is preserved: ${metadata ?? 'absent'}`,
    async (home) => {
      const path = mutationLeasePath(home);
      await mkdir(path, { recursive: true });
      if (metadata !== undefined)
        await writeFile(join(path, 'owner.json'), metadata);
      await expect(acquireMutationLease(home, 'competing')).rejects.toThrow(
        'ownership is unknown',
      );
      if (metadata !== undefined)
        expect(await readFile(join(path, 'owner.json'), 'utf8')).toBe(metadata);
      expect(await readdir(path)).toEqual(
        metadata === undefined ? [] : ['owner.json'],
      );
    },
  );
}

sandboxTest(
  'another host and inconclusive liveness never authorize reclamation',
  async (home) => {
    const lease = await acquireMutationLease(home, 'original');
    const file = join(mutationLeasePath(home), 'owner.json');
    const original = await readFile(file, 'utf8');
    try {
      const owner = JSON.parse(original);
      await writeFile(
        file,
        JSON.stringify({ ...owner, host: `${hostname()}-another` }),
      );
      await expect(acquireMutationLease(home, 'competing')).rejects.toThrow(
        'another host',
      );
      await writeFile(file, original);
      const kill = spyOn(process, 'kill').mockImplementation(() => {
        throw Object.assign(new Error('inconclusive'), { code: 'EPERM' });
      });
      try {
        await expect(acquireMutationLease(home, 'competing')).rejects.toThrow(
          'liveness is inconclusive',
        );
        expect(await readFile(file, 'utf8')).toBe(original);
      } finally {
        kill.mockRestore();
      }
    } finally {
      await writeFile(file, original);
      await lease.release();
    }
  },
);

sandboxTest(
  'release is token-checked and cannot remove a replacement owner',
  async (home) => {
    const lease = await acquireMutationLease(home, 'original');
    const path = mutationLeasePath(home);
    const file = join(path, 'owner.json');
    const original = await readFile(file, 'utf8');
    const replacement = `${JSON.stringify({ ...JSON.parse(original), token: randomUUID(), operation: 'replacement' })}\n`;
    await writeFile(file, replacement);
    try {
      await expect(lease.release()).rejects.toThrow('ownership changed');
      expect(await readFile(file, 'utf8')).toBe(replacement);
      expect(await readdir(path)).toEqual(['owner.json']);
    } finally {
      await writeFile(file, original);
      await lease.release();
    }
  },
);
