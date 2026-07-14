import { expect } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deployedPath } from '../../src/assets/ref';
import { readDeployedManifest } from '../../src/provisioning/activation/manifest';
import { sandboxedTest } from '../fixtures/temporary-directory';

const CONFIG_KEY = 'sample/global/manifest.json';

const sandboxTest = sandboxedTest('manifest-');

async function deploy(home: string, contents: string): Promise<void> {
  const path = deployedPath({ key: CONFIG_KEY }, home);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, contents);
}

sandboxTest(
  'passes the raw contents and concrete path to parse and returns its result',
  async (home) => {
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
  },
);

sandboxTest('awaits an asynchronous parse', async (home) => {
  await deploy(home, 'raw');
  const parsed = await readDeployedManifest(
    CONFIG_KEY,
    home,
    async (raw) => `parsed:${raw}`,
    'Sample manifest',
  );
  expect(parsed).toBe('parsed:raw');
});

sandboxTest(
  'a missing file becomes the labeled deploy-first guidance',
  async (home) => {
    await expect(
      readDeployedManifest(CONFIG_KEY, home, () => null, 'Sample manifest'),
    ).rejects.toThrow(
      /Sample manifest not found:.*Run provisioning to deploy it first/s,
    );
  },
);

sandboxTest(
  'a non-ENOENT filesystem error keeps its cause and is not mislabeled',
  async (home) => {
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
  },
);
