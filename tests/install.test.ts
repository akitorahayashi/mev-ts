import { expect, test } from 'bun:test';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withTemporaryDirectory } from './fixtures/temporary-directory';

const SHA256 =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

async function fakeCommands(dir: string, log: string): Promise<string> {
  const bashEnv = join(dir, 'fake-commands.bash');
  await writeFile(
    bashEnv,
    `uname() {
  if [ "$1" = "-s" ]; then
    printf 'Darwin\\n'
  else
    printf 'arm64\\n'
  fi
}

mktemp() {
  local template
  if [ "$1" = "-d" ] && [ "$2" = "-t" ]; then
    template="\${TMPDIR:-/tmp}/$3"
  elif [ "$1" = "-d" ]; then
    template="$2"
  else
    return 64
  fi
  local path="\${template%XXXXXX}\${RANDOM}\${RANDOM}"
  mkdir "$path"
  printf '%s\\n' "$path"
}

curl() {
  local out=""
  {
    printf 'curl'
    printf ' %s' "$@"
    printf '\\n'
  } >> "${log}"
  while [ "$#" -gt 0 ]; do
    if [ "$1" = "-o" ]; then
      out="$2"
      shift 2
    else
      shift
    fi
  done
  if [ "\${MEV_FAKE_CURL_FAIL:-}" = "1" ]; then
    echo "curl failed" >&2
    return 7
  fi
  case "$out" in
    *.sha256) printf '%s  mev\\n' "${SHA256}" > "$out" ;;
    *) printf binary > "$out" ;;
  esac
}

shasum() {
  printf '%s  %s\\n' "${SHA256}" "$3"
}

awk() {
  if [ "$1" != "{print \\$1}" ]; then
    command awk "$@"
    return
  fi
  if [ "$#" -gt 1 ]; then
    while read -r first _; do
      printf '%s\\n' "$first"
    done < "$2"
  else
    while read -r first _; do
      printf '%s\\n' "$first"
    done
  fi
}

install() {
  if [ "\${MEV_FAKE_INSTALL_FAIL:-}" = "1" ]; then
    echo "install failed" >&2
    return 9
  fi
  local src="$3"
  local dest="$4"
  mkdir -p "\${dest%/*}"
  cp "$src" "$dest"
  chmod 755 "$dest"
  printf 'install %s\\n' "$dest" >> "${log}"
}
`,
  );
  return bashEnv;
}

async function runInstaller(
  dir: string,
  env: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(['/bin/bash', 'install.sh'], {
    cwd: process.cwd(),
    env: {
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      ...env,
      MEV_BINARY_URL: 'https://example.test/mev',
      MEV_INSTALL_DIR: join(dir, 'bin'),
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
      const bashEnv = await fakeCommands(dir, log);

      const result = await runInstaller(dir, {
        BASH_ENV: bashEnv,
        MEV_BINARY_SHA256: SHA256,
        TMPDIR: tmp,
      });

      expect(result.code).toBe(0);
      expect(await readFile(join(dir, 'bin', 'mev'), 'utf8')).toBe('binary');
      const calls = await readFile(log, 'utf8');
      expect(calls.match(/^curl /gm)).toHaveLength(1);
      expect(calls).toContain('--proto =https --proto-redir =https --tlsv1.2');
      expect(calls).toContain(`${tmp}/`);
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
      const bashEnv = await fakeCommands(dir, log);

      const result = await runInstaller(dir, {
        BASH_ENV: bashEnv,
        TMPDIR: tmp,
      });

      expect(result.code).toBe(0);
      const calls = await readFile(log, 'utf8');
      expect(calls.match(/^curl /gm)).toHaveLength(2);
      expect(calls).toContain('--proto =https --proto-redir =https --tlsv1.2');
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
      const bashEnv = await fakeCommands(dir, join(dir, 'calls.log'));

      const result = await runInstaller(dir, {
        BASH_ENV: bashEnv,
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
      const bashEnv = await fakeCommands(dir, join(dir, 'calls.log'));

      const result = await runInstaller(dir, {
        BASH_ENV: bashEnv,
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
