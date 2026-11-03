import { expect } from 'bun:test';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { lstatIfPresent } from '../../src/host/absence';
import { sandboxedTest } from '../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('mev-huggingface-shell-');
const asset = resolve(
  import.meta.dir,
  '../../src/assets/config/shell/alias/hf.zsh',
);

async function shell(
  directory: string,
  script: string,
  available: boolean,
  initialized = true,
) {
  const prefix = join(directory, 'Homebrew prefix');
  const brewBin = join(prefix, 'bin');
  const legacyBin = join(directory, 'legacy');
  await mkdir(brewBin, { recursive: true });
  await mkdir(legacyBin);
  await writeFile(
    join(legacyBin, 'hf'),
    '#!/bin/sh\nprintf legacy >> "$MEV_TEST_LEGACY_LOG"\n',
  );
  await chmod(join(legacyBin, 'hf'), 0o755);
  if (available) {
    await writeFile(
      join(brewBin, 'hf'),
      '#!/bin/sh\nprintf "%s\\n" "$@" >> "$MEV_TEST_HF_LOG"\n',
    );
    await chmod(join(brewBin, 'hf'), 0o755);
  }
  // Alias expansion and PATH precedence require the real shell interpreter.
  const process = Bun.spawn(
    ['/bin/zsh', '-f', '-c', `source "$MEV_TEST_HF_ASSET"\n${script}`],
    {
      env: {
        ...Bun.env,
        HOMEBREW_PREFIX: initialized ? prefix : '',
        MEV_TEST_HF_ASSET: asset,
        MEV_TEST_HF_LOG: join(directory, 'hf.log'),
        MEV_TEST_LEGACY_LOG: join(directory, 'legacy.log'),
        PATH: `${legacyBin}:${brewBin}:/usr/bin:/bin`,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const [code, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

sandboxTest(
  'HF commands use Homebrew even with an older executable earlier in PATH',
  async (directory) => {
    const result = await shell(
      directory,
      [
        "eval 'hf version'",
        "eval 'hf-au status'",
        "eval 'hf-au-in'",
        "eval 'hf-au-ot'",
        'eval \'hf-dl publisher/vision --local-dir "model directory"\'',
        "eval 'hf-c ls'",
      ].join('\n'),
      true,
    );
    expect(result.code).toBe(0);
    expect(await readFile(join(directory, 'hf.log'), 'utf8')).toBe(
      [
        'version',
        'auth',
        'status',
        'auth',
        'login',
        'auth',
        'logout',
        'download',
        'publisher/vision',
        '--local-dir',
        'model directory',
        'cache',
        'ls',
        '',
      ].join('\n'),
    );
    expect(await lstatIfPresent(join(directory, 'legacy.log'))).toBeNull();
  },
);

sandboxTest(
  'HF commands fail when the Homebrew executable is missing',
  async (directory) => {
    const result = await shell(directory, "eval 'hf-c ls'", false);
    expect(result.code).toBe(127);
    expect(await lstatIfPresent(join(directory, 'legacy.log'))).toBeNull();
  },
);

sandboxTest(
  'HF commands report an unavailable Homebrew shell environment',
  async (directory) => {
    const result = await shell(directory, "eval 'hf version'", true, false);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('Homebrew shell environment');
    expect(await lstatIfPresent(join(directory, 'legacy.log'))).toBeNull();
  },
);
