import { expect } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  pluginSourcePath,
  readPluginSshHost,
  writePluginSshHost,
} from '../../src/agent-plugin/source';
import { sandboxedTest } from '../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('agent-plugin-source-');

sandboxTest(
  'uses the catalog default when no local override exists',
  async (home) => {
    await expect(readPluginSshHost(home, 'github.com')).resolves.toBe(
      'github.com',
    );
  },
);

sandboxTest(
  'writes and reads a per-machine SSH host override',
  async (home) => {
    const path = await writePluginSshHost(home, ' github-personal ');

    expect(path).toBe(pluginSourcePath(home));
    await expect(readPluginSshHost(home, 'github.com')).resolves.toBe(
      'github-personal',
    );
  },
);

sandboxTest(
  'rejects a malformed local source instead of using the default',
  async (home) => {
    const path = pluginSourcePath(home);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, 'ssh_host: git@github.com\n');

    await expect(readPluginSshHost(home, 'github.com')).rejects.toThrow(
      /ssh_host/,
    );
  },
);
