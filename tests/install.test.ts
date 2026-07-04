import { expect, test } from 'bun:test';
import { chmod, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withTemporaryDirectory } from './fixtures/temporary-directory';

const SHA256 =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

async function writeExecutable(path: string, body: string): Promise<void> {
  await writeFile(path, body);
  await chmod(path, 0o755);
}

async function fakeTools(bin: string, log: string): Promise<void> {
  await mkdir(bin, { recursive: true });
  await writeExecutable(
    join(bin, 'uname'),
    `#!/usr/bin/env bash
if [ "$1" = "-s" ]; then
  echo Darwin
else
  echo arm64
fi
`,
  );
  await writeExecutable(
    join(bin, 'curl'),
    `#!/usr/bin/env bash
set -euo pipefail
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    out="$2"
    shift 2
  else
    shift
  fi
done
printf 'curl %s\\n' "$out" >> "${log}"
if [ "\${MEV_FAKE_CURL_FAIL:-}" = "1" ]; then
  echo "curl failed" >&2
  exit 7
fi
case "$out" in
  *.sha256) printf '%s  mev\\n' "${SHA256}" > "$out" ;;
  *) printf binary > "$out" ;;
esac
`,
  );
  await writeExecutable(
    join(bin, 'shasum'),
    `#!/usr/bin/env bash
printf '%s  %s\\n' "${SHA256}" "$3"
`,
  );
  await writeExecutable(
    join(bin, 'install'),
    `#!/usr/bin/env bash
set -euo pipefail
if [ "\${MEV_FAKE_INSTALL_FAIL:-}" = "1" ]; then
  echo "install failed" >&2
  exit 9
fi
src="$3"
dest="$4"
mkdir -p "$(dirname "$dest")"
cp "$src" "$dest"
chmod 755 "$dest"
printf 'install %s\\n' "$dest" >> "${log}"
`,
  );
}

async function runInstaller(
  dir: string,
  env: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(['/bin/bash', 'install.sh'], {
    cwd: process.cwd(),
    env: {
      ...Bun.env,
      ...env,
      MEV_BINARY_URL: 'https://example.test/mev',
      MEV_INSTALL_DIR: join(dir, 'bin'),
      PATH: `${join(dir, 'fake-bin')}:${Bun.env.PATH}`,
    },
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

test('installer downloads one binary when checksum is supplied and cleans TMPDIR with spaces', async () => {
  await withTemporaryDirectory(
    async (dir) => {
      const log = join(dir, 'calls.log');
      const tmp = join(dir, 'tmp root');
      await mkdir(tmp);
      await fakeTools(join(dir, 'fake-bin'), log);

      const result = await runInstaller(dir, {
        MEV_BINARY_SHA256: SHA256,
        TMPDIR: tmp,
      });

      expect(result.code).toBe(0);
      expect(await readFile(join(dir, 'bin', 'mev'), 'utf8')).toBe('binary');
      const calls = await readFile(log, 'utf8');
      expect(calls.match(/^curl /gm)).toHaveLength(1);
      expect(calls).toContain(`curl ${tmp}/`);
      expect(await readdir(tmp)).toEqual([]);
    },
    { prefix: 'installer-success-' },
  );
});

test('installer downloads checksum when no checksum value is supplied', async () => {
  await withTemporaryDirectory(
    async (dir) => {
      const log = join(dir, 'calls.log');
      const tmp = join(dir, 'tmp root');
      await mkdir(tmp);
      await fakeTools(join(dir, 'fake-bin'), log);

      const result = await runInstaller(dir, { TMPDIR: tmp });

      expect(result.code).toBe(0);
      const calls = await readFile(log, 'utf8');
      expect(calls.match(/^curl /gm)).toHaveLength(2);
      expect(await readdir(tmp)).toEqual([]);
    },
    { prefix: 'installer-checksum-' },
  );
});

test('installer cleans temporary files after download failure', async () => {
  await withTemporaryDirectory(
    async (dir) => {
      const tmp = join(dir, 'tmp root');
      await mkdir(tmp);
      await fakeTools(join(dir, 'fake-bin'), join(dir, 'calls.log'));

      const result = await runInstaller(dir, {
        MEV_BINARY_SHA256: SHA256,
        MEV_FAKE_CURL_FAIL: '1',
        TMPDIR: tmp,
      });

      expect(result.code).toBe(7);
      expect(result.stderr).toContain('curl failed');
      expect(await Bun.file(join(dir, 'bin', 'mev')).exists()).toBe(false);
      expect(await readdir(tmp)).toEqual([]);
    },
    { prefix: 'installer-download-failure-' },
  );
});

test('installer cleans temporary files after install failure', async () => {
  await withTemporaryDirectory(
    async (dir) => {
      const tmp = join(dir, 'tmp root');
      await mkdir(tmp);
      await fakeTools(join(dir, 'fake-bin'), join(dir, 'calls.log'));

      const result = await runInstaller(dir, {
        MEV_BINARY_SHA256: SHA256,
        MEV_FAKE_INSTALL_FAIL: '1',
        TMPDIR: tmp,
      });

      expect(result.code).toBe(9);
      expect(result.stderr).toContain('install failed');
      expect(await Bun.file(join(dir, 'bin', 'mev')).exists()).toBe(false);
      expect(await readdir(tmp)).toEqual([]);
    },
    { prefix: 'installer-install-failure-' },
  );
});
