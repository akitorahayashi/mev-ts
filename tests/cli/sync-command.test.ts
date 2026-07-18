import { expect } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { embeddedAssets } from '../../src/assets/registry';
import { runCommandLine } from '../../src/main';
import { appliedPath, writeApplied } from '../../src/provisioning/applied';
import { deployRole } from '../../src/provisioning/deploy';
import { fullSetupTargets } from '../../src/provisioning/registry';
import { targetSignature } from '../../src/provisioning/signature';
import { recordingContext } from '../fixtures/fake-context';
import { sandboxedTest } from '../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('sync-command-');

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

sandboxTest(
  'sync exits without provisioning when the full setup is current',
  async (sandbox) => {
    const targets = fullSetupTargets();
    const context = recordingContext({
      home: sandbox,
      assets: embeddedAssets,
    }).context;
    for (const target of targets) {
      await deployRole(target.role, context);
      await writeApplied(
        appliedPath(sandbox, target.name),
        await targetSignature(target, embeddedAssets),
      );
    }

    let stdout = '';
    let stderr = '';
    const previousHome = process.env.HOME;
    const previousPath = process.env.PATH;
    const bin = join(sandbox, 'bin');
    await mkdir(bin);
    process.env.HOME = sandbox;
    process.env.PATH = bin;
    try {
      const code = await runCommandLine(['sync', 'mbk'], {
        colorDepth: 1,
        stdout: {
          write(chunk: string | Uint8Array) {
            stdout += String(chunk);
            return true;
          },
        } as NodeJS.WriteStream,
        stderr: {
          write(chunk: string | Uint8Array) {
            stderr += String(chunk);
            return true;
          },
        } as NodeJS.WriteStream,
      });

      expect(code).toBe(0);
      expect(stdout).toBe('mev: macbook environment is synchronized\n');
      expect(stderr).toBe('');
    } finally {
      restoreEnv('HOME', previousHome);
      restoreEnv('PATH', previousPath);
    }
  },
);
