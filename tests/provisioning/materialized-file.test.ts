import { expect } from 'bun:test';
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { deployedPath } from '../../src/assets/ref';
import { home } from '../../src/host/path';
import {
  materializeFile,
  runActivation,
} from '../../src/provisioning/activation';
import { emptyAssets, recordingContext } from '../fixtures/fake-context';
import { sandboxedTest } from '../fixtures/temporary-directory';

const sandbox = sandboxedTest('mev-materialized-file-');
const source = { key: 'demo/config.toml' };

async function fixture(directory: string) {
  const deployed = deployedPath(source, directory);
  await mkdir(dirname(deployed), { recursive: true });
  await writeFile(deployed, 'enabled = true\n');
  const context = recordingContext({
    home: directory,
    assets: emptyAssets,
  }).context;
  const dest = join(directory, 'Desktop', 'config.toml');
  const activation = materializeFile(source, home('Desktop/config.toml'));
  return { activation, context, deployed, dest };
}

sandbox('places a missing asset destination as a regular file', async (dir) => {
  const { activation, context, dest } = await fixture(dir);

  const report = await runActivation(activation, context);

  expect(report.status).toBe('changed');
  expect((await lstat(dest)).isFile()).toBe(true);
  expect(await readFile(dest, 'utf8')).toBe('enabled = true\n');
});

sandbox('leaves an identical regular file in place', async (dir) => {
  const { activation, context, dest } = await fixture(dir);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, 'enabled = true\n');
  const before = await stat(dest);

  const report = await runActivation(activation, context);

  expect(report.status).toBe('unchanged');
  expect((await stat(dest)).ino).toBe(before.ino);
});

sandbox('replaces different regular-file contents', async (dir) => {
  const { activation, context, dest } = await fixture(dir);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, 'enabled = false\n');

  const report = await runActivation(activation, context);

  expect(report.status).toBe('changed');
  expect(await readFile(dest, 'utf8')).toBe('enabled = true\n');
});

sandbox('repairs executable-bit drift', async (dir) => {
  const { activation, context, deployed, dest } = await fixture(dir);
  await chmod(deployed, 0o755);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, 'enabled = true\n', { mode: 0o644 });

  const report = await runActivation(activation, context);

  expect(report.status).toBe('changed');
  expect((await stat(dest)).mode & 0o111).toBe(0o111);
});

sandbox('materializes an identical symlink as a regular file', async (dir) => {
  const { activation, context, deployed, dest } = await fixture(dir);
  await mkdir(dirname(dest), { recursive: true });
  await symlink(deployed, dest);

  const report = await runActivation(activation, context);

  expect(report.status).toBe('changed');
  expect((await lstat(dest)).isSymbolicLink()).toBe(false);
  expect(await readFile(dest, 'utf8')).toBe('enabled = true\n');
});

sandbox('replaces a directory at the destination', async (dir) => {
  const { activation, context, dest } = await fixture(dir);
  await mkdir(dest, { recursive: true });
  await writeFile(join(dest, 'stale'), 'stale');

  const report = await runActivation(activation, context);

  expect(report.status).toBe('changed');
  expect((await lstat(dest)).isFile()).toBe(true);
  expect(await readFile(dest, 'utf8')).toBe('enabled = true\n');
});
