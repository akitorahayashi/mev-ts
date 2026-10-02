import { expect, test } from 'bun:test';
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withTemporaryDirectory } from './fixtures/temporary-directory';

const SHA256 =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const MISMATCHED_SHA256 =
  'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
const BINARY = `#!/bin/sh
if [ "$1" != "--version" ]; then
  exit 64
fi
if [ "\${MEV_FAKE_VERSION_FAIL:-}" = "1" ]; then
  echo "version failed" >&2
  exit 8
fi
printf '1.2.3\\n'
`;

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
    *)
      cat > "$out" <<'MEV_TEST_BINARY'
${BINARY}MEV_TEST_BINARY
      ;;
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
      MEV_BINARY_URL: 'https://example.test/mev',
      MEV_INSTALL_DIR: join(dir, 'bin'),
      ...env,
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

test('installer rejects a colon in the install directory before downloading or creating it', async () => {
  await withTemporaryDirectory(
    async (dir) => {
      const installDir = join(dir, 'mev:bin');
      const log = join(dir, 'calls.log');
      const bashEnv = await fakeCommands(dir, log);
      const tmp = join(dir, 'tmp');
      await mkdir(tmp);

      const result = await runInstaller(dir, {
        BASH_ENV: bashEnv,
        MEV_BINARY_SHA256: SHA256,
        MEV_INSTALL_DIR: installDir,
        TMPDIR: tmp,
      });

      expect(result.code).toBe(1);
      expect(result.stderr).toContain('MEV_INSTALL_DIR');
      expect(result.stderr).toContain('PATH');
      expect(result.stderr).toContain(':');
      expect(await Bun.file(log).exists()).toBe(false);
      await expect(access(installDir)).rejects.toMatchObject({
        code: 'ENOENT',
      });
      expect(await readdir(tmp)).toEqual([]);
    },
    { prefix: 'installer-invalid-directory-' },
  );
});

// The shell executes the installer's copyable PATH command, the boundary under test.
test.each([
  '/bin/bash',
  '/bin/zsh',
])('installer PATH instructions resolve the installed binary safely in %s', async (shell) => {
  await withTemporaryDirectory(
    async (dir) => {
      const installDir = join(
        dir,
        "bin with 'quotes' $cash `touch injected` $(touch injected)",
      );
      const bashEnv = await fakeCommands(dir, join(dir, 'calls.log'));
      const result = await runInstaller(dir, {
        BASH_ENV: bashEnv,
        MEV_BINARY_SHA256: SHA256,
        MEV_INSTALL_DIR: installDir,
        TMPDIR: dir,
      });
      expect(result.code).toBe(0);
      const pathCommand = result.stdout
        .split('\n')
        .find((line) => line.trimStart().startsWith('export PATH='));
      if (!pathCommand)
        throw new Error('installer did not provide a PATH command');

      const proc = Bun.spawn(
        [shell, '-f', '-c', `${pathCommand}\ncommand -v mev\nmev --version`],
        {
          cwd: dir,
          env: { HOME: dir, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      expect(code).toBe(0);
      expect(stderr).toBe('');
      expect(stdout).toBe(`${join(installDir, 'mev')}\n1.2.3\n`);
      expect(await Bun.file(join(dir, 'injected')).exists()).toBe(false);
    },
    { prefix: 'installer-path-' },
  );
});

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
      expect(await readFile(join(dir, 'bin', 'mev'), 'utf8')).toBe(BINARY);
      expect(result.stdout).toContain(
        `Installed mev 1.2.3 to ${join(dir, 'bin', 'mev')}`,
      );
      const calls = await readFile(log, 'utf8');
      expect(calls.match(/^curl /gm)).toHaveLength(1);
      expect(calls).toContain('--proto =https --proto-redir =https --tlsv1.2');
      expect(calls).toContain(`${tmp}/`);
      expect(await readdir(tmp)).toEqual([]);
    },
    { prefix: 'installer-success-' },
  );
});

test('installer reports the installed version when PATH contains an older mev', async () => {
  await withTemporaryDirectory(
    async (dir) => {
      const oldBin = join(dir, 'old bin');
      await mkdir(oldBin);
      await writeFile(join(oldBin, 'mev'), "#!/bin/sh\nprintf '0.1.0\\n'\n", {
        mode: 0o755,
      });
      const bashEnv = await fakeCommands(dir, join(dir, 'calls.log'));

      const result = await runInstaller(dir, {
        BASH_ENV: bashEnv,
        MEV_BINARY_SHA256: SHA256,
        PATH: `${oldBin}:/usr/bin:/bin:/usr/sbin:/sbin`,
      });

      expect(result.code).toBe(0);
      expect(result.stdout).toContain(
        `Installed mev 1.2.3 to ${join(dir, 'bin', 'mev')}`,
      );
      expect(result.stdout).not.toContain('0.1.0');
    },
    { prefix: 'installer version-' },
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

test('installer aborts and installs nothing when the checksum does not match', async () => {
  await withTemporaryDirectory(
    async (dir) => {
      const tmp = join(dir, 'tmp root');
      await mkdir(tmp);
      const bashEnv = await fakeCommands(dir, join(dir, 'calls.log'));

      const result = await runInstaller(dir, {
        BASH_ENV: bashEnv,
        MEV_BINARY_SHA256: MISMATCHED_SHA256,
        TMPDIR: tmp,
      });

      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain('SHA256 mismatch');
      expect(result.stderr).toContain(MISMATCHED_SHA256);
      expect(result.stderr).toContain(SHA256);
      expect(await Bun.file(join(dir, 'bin', 'mev')).exists()).toBe(false);
      expect(await readdir(tmp)).toEqual([]);
    },
    { prefix: 'installer-mismatch-' },
  );
});

test('installer aborts and installs nothing when the checksum format is invalid', async () => {
  await withTemporaryDirectory(
    async (dir) => {
      const tmp = join(dir, 'tmp root');
      await mkdir(tmp);
      const bashEnv = await fakeCommands(dir, join(dir, 'calls.log'));

      const result = await runInstaller(dir, {
        BASH_ENV: bashEnv,
        MEV_BINARY_SHA256: 'not-a-valid-sha256',
        TMPDIR: tmp,
      });

      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain('Invalid SHA256 checksum format');
      expect(await Bun.file(join(dir, 'bin', 'mev')).exists()).toBe(false);
      expect(await readdir(tmp)).toEqual([]);
    },
    { prefix: 'installer-malformed-' },
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

test('installer fails without reporting success when the installed version probe fails', async () => {
  await withTemporaryDirectory(
    async (dir) => {
      const tmp = join(dir, 'tmp root');
      await mkdir(tmp);
      const bashEnv = await fakeCommands(dir, join(dir, 'calls.log'));

      const result = await runInstaller(dir, {
        BASH_ENV: bashEnv,
        MEV_BINARY_SHA256: SHA256,
        MEV_FAKE_VERSION_FAIL: '1',
        TMPDIR: tmp,
      });

      expect(result.code).toBe(8);
      expect(result.stderr).toContain('version failed');
      expect(result.stdout).not.toContain('Installed mev');
      expect(await readdir(tmp)).toEqual([]);
    },
    { prefix: 'installer-version-failure-' },
  );
});
