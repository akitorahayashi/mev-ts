import { expect } from 'bun:test';
import { lstat, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pruneDeployStore } from '../../src/provisioning/deploy-store';
import { sandboxedTest } from '../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('deploy-store-');

async function write(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, 'state');
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

sandboxTest(
  'pruneDeployStore removes only unregistered mev roles and applied markers',
  async (home) => {
    await write(join(home, '.mev/roles/brew/cask/Brewfile'));
    await write(join(home, '.mev/roles/brew/formulae/Brewfile'));
    await write(join(home, '.mev/roles/brew/old/Brewfile'));
    await write(join(home, '.mev/roles/cmux/config.yml'));
    await write(join(home, '.mev/roles/.cmux.abcdef/backup/config.yml'));
    await write(join(home, '.mev/roles/brew/.cask.abcdef/backup/Brewfile'));
    await write(join(home, '.mev/applied/cask'));
    await write(join(home, '.mev/applied/cmux'));
    await write(join(home, '.mev/applied/.cmux.abcdef/file'));

    const report = await pruneDeployStore(
      {
        roles: ['brew/cask', 'brew/formulae'],
        targets: ['cask', 'formulae'],
      },
      { home },
    );

    expect(report).toEqual({
      roles: ['brew/old', 'cmux'],
      appliedTargets: ['cmux'],
    });
    expect(await exists(join(home, '.mev/roles/brew/cask'))).toBe(true);
    expect(await exists(join(home, '.mev/roles/brew/formulae'))).toBe(true);
    expect(await exists(join(home, '.mev/roles/brew/old'))).toBe(false);
    expect(await exists(join(home, '.mev/roles/cmux'))).toBe(false);
    expect(await exists(join(home, '.mev/roles/.cmux.abcdef'))).toBe(true);
    expect(await exists(join(home, '.mev/roles/brew/.cask.abcdef'))).toBe(true);
    expect(await exists(join(home, '.mev/applied/cask'))).toBe(true);
    expect(await exists(join(home, '.mev/applied/cmux'))).toBe(false);
    expect(await exists(join(home, '.mev/applied/.cmux.abcdef'))).toBe(true);
  },
);

sandboxTest('pruneDeployStore accepts absent mev roots', async (home) => {
  await expect(
    pruneDeployStore({ roles: ['coder'], targets: ['coder'] }, { home }),
  ).resolves.toEqual({ roles: [], appliedTargets: [] });
});
