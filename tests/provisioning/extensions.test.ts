import { expect } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CommandResult } from '../../src/host/command';
import {
  installExtensions,
  runActivation,
} from '../../src/provisioning/activation';
import { recordingContext } from '../fixtures/fake-context';
import { sandboxedTest } from '../fixtures/temporary-directory';

const CONFIG_KEY = 'vscode/global/extensions.json';

const MANIFEST = JSON.stringify({
  extensions: ['publisher.alpha', 'publisher.Beta', 'publisher.gamma'],
});

const sandboxTest = sandboxedTest('extensions-');

async function deployManifest(dir: string): Promise<void> {
  const roleDir = join(dir, '.mev/roles/vscode/global');
  await mkdir(roleDir, { recursive: true });
  await writeFile(join(roleDir, 'extensions.json'), MANIFEST);
}

const ok = (stdout = ''): CommandResult => ({ code: 0, stdout, stderr: '' });
const fail = (stderr = ''): CommandResult => ({ code: 1, stdout: '', stderr });

sandboxTest(
  'unchanged when every desired extension is already installed',
  async (dir) => {
    await deployManifest(dir);
    const { context, calls } = recordingContext({
      home: dir,
      respond: (_cmd, args) => {
        if (args[0] === '--list-extensions') {
          // Different casing must still count as installed.
          return ok('publisher.Alpha\npublisher.beta\npublisher.GAMMA');
        }
        return fail();
      },
    });

    const report = await runActivation(
      installExtensions('code', CONFIG_KEY),
      context,
    );

    expect(report.status).toBe('unchanged');
    expect(calls).toHaveLength(1);
    expect(report.entries?.every((e) => e.status === 'unchanged')).toBe(true);
  },
);

sandboxTest('installs only the missing extensions', async (dir) => {
  await deployManifest(dir);
  const { context, calls } = recordingContext({
    home: dir,
    respond: (_cmd, args) => {
      if (args[0] === '--list-extensions') return ok('publisher.beta');
      if (args[0] === '--install-extension') return ok();
      return fail();
    },
  });

  const report = await runActivation(
    installExtensions('code', CONFIG_KEY),
    context,
  );

  expect(report.status).toBe('changed');
  const installs = calls.filter((c) => c.args[0] === '--install-extension');
  expect(installs.map((c) => c.args[1])).toEqual([
    'publisher.alpha',
    'publisher.gamma',
  ]);
});

sandboxTest('failed when an install command returns non-zero', async (dir) => {
  await deployManifest(dir);
  const { context } = recordingContext({
    home: dir,
    respond: (_cmd, args) => {
      if (args[0] === '--list-extensions') return ok('');
      if (args[0] === '--install-extension') return fail('network error');
      return fail();
    },
  });

  const report = await runActivation(
    installExtensions('code', CONFIG_KEY),
    context,
  );

  expect(report.status).toBe('failed');
  expect(report.entries?.some((e) => e.error?.includes('network error'))).toBe(
    true,
  );
});

sandboxTest('failed when the editor CLI is unavailable', async (dir) => {
  await deployManifest(dir);
  const { context } = recordingContext({
    home: dir,
    respond: () => fail('command not found'),
  });

  const report = await runActivation(
    installExtensions('code', CONFIG_KEY),
    context,
  );

  expect(report.status).toBe('failed');
});

sandboxTest(
  'failed when the extension manifest contains invalid entries',
  async (dir) => {
    const roleDir = join(dir, '.mev/roles/vscode/global');
    await mkdir(roleDir, { recursive: true });
    await writeFile(
      join(roleDir, 'extensions.json'),
      JSON.stringify({ extensions: ['publisher.alpha', '  '] }),
    );
    const { context, calls } = recordingContext({
      home: dir,
      respond: () => ok(),
    });

    const report = await runActivation(
      installExtensions('code', CONFIG_KEY),
      context,
    );

    expect(report.status).toBe('failed');
    expect(report.error).toContain('extensions array of non-empty strings');
    expect(calls).toHaveLength(0);
  },
);
