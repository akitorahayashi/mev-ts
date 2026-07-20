import { expect } from 'bun:test';
import {
  lstat,
  mkdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { asset, deployedDir, deployedPath } from '../../src/assets/ref';
import type { AssetSource } from '../../src/assets/registry';
import type { Context } from '../../src/host/context';
import { home } from '../../src/host/path';
import {
  link,
  linkTree,
  runActivation,
} from '../../src/provisioning/activation';
import { recordingContext } from '../fixtures/fake-context';
import { sandboxedTest } from '../fixtures/temporary-directory';

const aliasPrefix = 'shell/alias/';
const ALIAS_KEYS = [`${aliasPrefix}a.zsh`, `${aliasPrefix}sub/b.zsh`];
const ALL_KEYS = ['git/.gitconfig', ...ALIAS_KEYS];

const assets: AssetSource = {
  async read(key) {
    return `content of ${key}\n`;
  },
  keysByPrefix(prefix) {
    return ALL_KEYS.filter((key) => key.startsWith(prefix));
  },
  isExecutable() {
    return false;
  },
};

const sandboxTest = sandboxedTest('activate-');

const contextFor = (homeDir: string): Context =>
  recordingContext({ home: homeDir, assets }).context;

async function deploy(context: Context, key: string) {
  const dest = deployedPath({ key }, context.home);
  await mkdir(join(dest, '..'), { recursive: true });
  await writeFile(dest, await context.assets.read(key));
}

sandboxTest(
  'link creates a symlink to the deployed asset and is idempotent',
  async (sandbox) => {
    const context = contextFor(sandbox);
    const ref = asset('git/.gitconfig');
    await deploy(context, ref.key);
    const activation = link(ref, home('.config/git/config'));

    const first = await runActivation(activation, context);
    expect(first.status).toBe('changed');
    expect(first.verb).toBe('link');
    expect(await readlink(join(sandbox, '.config/git/config'))).toBe(
      deployedPath(ref, sandbox),
    );

    const second = await runActivation(activation, context);
    expect(second.status).toBe('unchanged');
  },
);

sandboxTest('link replaces an existing file', async (sandbox) => {
  const context = contextFor(sandbox);
  const ref = asset('git/.gitconfig');
  await deploy(context, ref.key);
  const dest = join(sandbox, '.config-target');
  await writeFile(dest, 'user content');

  const report = await runActivation(
    link(ref, home('.config-target')),
    context,
  );
  expect(report.status).toBe('changed');
  expect(await readlink(dest)).toBe(deployedPath(ref, sandbox));
});

sandboxTest('link replaces an existing directory', async (sandbox) => {
  const context = contextFor(sandbox);
  const ref = asset('git/.gitconfig');
  await deploy(context, ref.key);
  const dest = join(sandbox, '.config-target');
  await mkdir(dest);
  await writeFile(join(dest, 'stale'), 'stale');

  const report = await runActivation(
    link(ref, home('.config-target')),
    context,
  );

  expect(report.status).toBe('changed');
  expect(await readlink(dest)).toBe(deployedPath(ref, sandbox));
});

sandboxTest(
  'link surfaces filesystem errors while probing links',
  async (sandbox) => {
    const context = contextFor(sandbox);
    const ref = asset('git/.gitconfig');
    await deploy(context, ref.key);
    await writeFile(join(sandbox, '.blocked'), 'not a directory');

    const report = await runActivation(
      link(ref, home('.blocked/git/config')),
      context,
    );

    expect(report.status).toBe('failed');
    expect(report.error).toMatch(/not a directory/i);
  },
);

sandboxTest(
  'link replaces a symlink that points at the wrong target',
  async (sandbox) => {
    const context = contextFor(sandbox);
    const ref = asset('git/.gitconfig');
    await deploy(context, ref.key);
    const activation = link(ref, home('.config/git/config'));
    await runActivation(activation, context);

    const linkPath = join(sandbox, '.config/git/config');
    await rm(linkPath);
    await symlink(join(sandbox, 'wrong-target'), linkPath);

    const report = await runActivation(activation, context);

    expect(report.status).toBe('changed');
    expect(await readlink(linkPath)).toBe(deployedPath(ref, sandbox));
  },
);

sandboxTest(
  'linkTree mirrors deployed assets as symlinks and is idempotent',
  async (sandbox) => {
    const context = contextFor(sandbox);
    for (const key of ALIAS_KEYS) await deploy(context, key);
    const activation = linkTree(aliasPrefix, home('.mev/alias'));

    const first = await runActivation(activation, context);
    expect(first.status).toBe('changed');
    expect(await readlink(join(sandbox, '.mev/alias/a.zsh'))).toBe(
      deployedPath(asset(`${aliasPrefix}a.zsh`), sandbox),
    );
    expect(await readlink(join(sandbox, '.mev/alias/sub/b.zsh'))).toBe(
      deployedPath(asset(`${aliasPrefix}sub/b.zsh`), sandbox),
    );

    const second = await runActivation(activation, context);
    expect(second.status).toBe('unchanged');
  },
);

sandboxTest(
  'linkTree replaces a symlinked destination root with a real directory',
  async (sandbox) => {
    const context = contextFor(sandbox);
    for (const key of ALIAS_KEYS) await deploy(context, key);
    const root = join(sandbox, '.mev/alias');
    const legacyRoot = join(sandbox, 'legacy-alias');
    await mkdir(join(sandbox, '.mev'), { recursive: true });
    await mkdir(join(legacyRoot, 'sub'), { recursive: true });
    await symlink(join(legacyRoot, 'a.zsh'), join(legacyRoot, 'a.zsh'));
    await symlink(legacyRoot, root);

    const report = await runActivation(
      linkTree(aliasPrefix, home('.mev/alias')),
      context,
    );

    const rootStats = await lstat(root);
    expect(report.status).toBe('changed');
    expect(rootStats.isDirectory()).toBe(true);
    expect(rootStats.isSymbolicLink()).toBe(false);
    expect(await readlink(join(root, 'a.zsh'))).toBe(
      deployedPath(asset(`${aliasPrefix}a.zsh`), sandbox),
    );
    expect(await readlink(join(root, 'sub/b.zsh'))).toBe(
      deployedPath(asset(`${aliasPrefix}sub/b.zsh`), sandbox),
    );
  },
);

sandboxTest(
  'linkTree reports changed when it creates an empty destination root',
  async (sandbox) => {
    const context = contextFor(sandbox);
    const activation = linkTree('empty/', home('.empty-root'));
    const root = join(sandbox, '.empty-root');

    const first = await runActivation(activation, context);
    const second = await runActivation(activation, context);

    expect(first.status).toBe('changed');
    expect(second.status).toBe('unchanged');
    expect((await lstat(root)).isDirectory()).toBe(true);
  },
);

sandboxTest(
  'linkTree prunes a managed link that is no longer expected',
  async (sandbox) => {
    const context = contextFor(sandbox);
    for (const key of ALIAS_KEYS) await deploy(context, key);
    const activation = linkTree(aliasPrefix, home('.mev/alias'));
    await runActivation(activation, context);

    const stale = join(sandbox, '.mev/alias/removed.zsh');
    await symlink(
      join(deployedDir(aliasPrefix, sandbox), 'removed.zsh'),
      stale,
    );

    expect((await runActivation(activation, context)).status).toBe('changed');
    await expect(lstat(stale)).rejects.toThrow();
  },
);

sandboxTest(
  'linkTree leaves unmanaged files and foreign links untouched',
  async (sandbox) => {
    const context = contextFor(sandbox);
    for (const key of ALIAS_KEYS) await deploy(context, key);
    const activation = linkTree(aliasPrefix, home('.mev/alias'));
    await runActivation(activation, context);

    const userFile = join(sandbox, '.mev/alias/custom.zsh');
    await writeFile(userFile, 'user content');
    const foreignLink = join(sandbox, '.mev/alias/foreign.zsh');
    await symlink(join(sandbox, 'elsewhere/x.zsh'), foreignLink);

    await runActivation(activation, context);

    expect(await Bun.file(userFile).text()).toBe('user content');
    expect(await readlink(foreignLink)).toBe(join(sandbox, 'elsewhere/x.zsh'));
  },
);

sandboxTest(
  'linkTree only replaces expected links that drifted',
  async (sandbox) => {
    const context = contextFor(sandbox);
    for (const key of ALIAS_KEYS) await deploy(context, key);
    const activation = linkTree(aliasPrefix, home('.mev/alias'));
    await runActivation(activation, context);

    const correct = join(sandbox, '.mev/alias/a.zsh');
    const drifted = join(sandbox, '.mev/alias/sub/b.zsh');
    const before = await lstat(correct);
    await rm(drifted);
    await symlink(join(sandbox, 'wrong-target'), drifted);

    const report = await runActivation(activation, context);

    expect(report.status).toBe('changed');
    expect((await lstat(correct)).ino).toBe(before.ino);
    expect(await readlink(drifted)).toBe(
      deployedPath(asset(`${aliasPrefix}sub/b.zsh`), sandbox),
    );
  },
);
