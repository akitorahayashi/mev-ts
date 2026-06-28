import { expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deployedPath } from '../../src/assets/ref';
import { readDeployedManifest } from '../../src/provisioning/activation/manifest';

const CONFIG_KEY = 'sample/global/manifest.json';

async function withSandbox(fn: (home: string) => Promise<void>): Promise<void> {
  const home = join(
    process.cwd(),
    '.tmp',
    `manifest-${process.pid}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(home, { recursive: true });
  try {
    await fn(home);
  } finally {
    await rm(home, { force: true, recursive: true });
  }
}

async function deploy(home: string, contents: string): Promise<void> {
  const path = deployedPath({ key: CONFIG_KEY }, home);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, contents);
}

test('passes the raw contents and concrete path to parse and returns its result', async () => {
  await withSandbox(async (home) => {
    await deploy(home, '{"value":1}');
    let seenPath = '';
    const parsed = await readDeployedManifest(
      CONFIG_KEY,
      home,
      (raw, path) => {
        seenPath = path;
        return JSON.parse(raw) as { value: number };
      },
      'Sample manifest',
    );

    expect(parsed).toEqual({ value: 1 });
    expect(seenPath).toBe(deployedPath({ key: CONFIG_KEY }, home));
  });
});

test('awaits an asynchronous parse', async () => {
  await withSandbox(async (home) => {
    await deploy(home, 'raw');
    const parsed = await readDeployedManifest(
      CONFIG_KEY,
      home,
      async (raw) => `parsed:${raw}`,
      'Sample manifest',
    );
    expect(parsed).toBe('parsed:raw');
  });
});

test('a missing file becomes the labeled deploy-first guidance', async () => {
  await withSandbox(async (home) => {
    await expect(
      readDeployedManifest(CONFIG_KEY, home, () => null, 'Sample manifest'),
    ).rejects.toThrow(
      /Sample manifest not found:.*Run provisioning to deploy it first/s,
    );
  });
});

test('a non-ENOENT filesystem error keeps its cause and is not mislabeled', async () => {
  await withSandbox(async (home) => {
    // A directory at the manifest path makes readFile fail with EISDIR rather
    // than ENOENT; the loader must surface that cause, not "not found".
    const path = deployedPath({ key: CONFIG_KEY }, home);
    await mkdir(path, { recursive: true });

    const promise = readDeployedManifest(
      CONFIG_KEY,
      home,
      () => null,
      'Sample manifest',
    );
    await expect(promise).rejects.toThrow(/EISDIR/);
    await expect(promise).rejects.not.toThrow(/not found/);
  });
});
