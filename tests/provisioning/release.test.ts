import { expect } from 'bun:test';
import {
  chmod,
  mkdir,
  readdir,
  readFile,
  realpath,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import {
  releaseBinaries,
  runActivation,
} from '../../src/provisioning/activation';
import { fail, ok } from '../fixtures/fake-command-runner';
import {
  emptyAssets,
  type Responder,
  recordingContext,
} from '../fixtures/fake-context';
import { sandboxedTest } from '../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('release-');

// A successful download writes the destination file, so fetchReleaseBinary has
// real bytes to digest and mark executable. The async responder performs that
// side effect, so no bespoke Context is needed.
function releaseContext(home: string, responder: Responder) {
  return recordingContext({
    home,
    assets: emptyAssets,
    async respond(command, args) {
      const result = await responder(command, args);
      if (result.code === 0 && (command === 'curl' || command === 'gh')) {
        const flag = command === 'curl' ? '-o' : '--output';
        const i = args.indexOf(flag);
        if (i >= 0) await writeFile(args[i + 1] as string, command);
      }
      return result;
    },
  });
}

const CONFIG_KEY = 'rust-cli/binaries.yml';

// Digests of the bytes the responder writes for each transport.
const CURL_SHA =
  '427e4b79b1f0fc90306cbe064b1297b21dc6835bfa656d3bf46bc156e3f24bb0';
const GH_SHA =
  'fb2b7fce0940161406a6aa3e4d8b4aa6104014774ffa665743f8d9704f0eb0ec';

const PUBLIC_YAML = `
binaries:
  - name: kpv
    repo: akitorahayashi/kpv
    tag: v0.6.0
  - name: mx
    repo: akitorahayashi/mx
    tag: v3.1.0
`.trimStart();

const PUBLIC_LOCK = `
binaries:
  - name: kpv
    repo: akitorahayashi/kpv
    tag: v0.6.0
    assets:
      darwin-aarch64:
        sha256: ${CURL_SHA}
  - name: mx
    repo: akitorahayashi/mx
    tag: v3.1.0
    assets:
      darwin-aarch64:
        sha256: ${CURL_SHA}
`.trimStart();

async function deployBinaries(
  home: string,
  yaml: string,
  lock: string | null = PUBLIC_LOCK,
): Promise<void> {
  const roleDir = join(home, '.mev', 'roles', 'rust-cli');
  await mkdir(roleDir, { recursive: true });
  await writeFile(join(roleDir, 'binaries.yml'), yaml);
  if (lock !== null) {
    await writeFile(join(roleDir, 'binaries.lock.yml'), lock);
  }
}

sandboxTest(
  'first run: an absent binary is fetched and installed, not aborted',
  async (home) => {
    await deployBinaries(home, PUBLIC_YAML);
    const { context, calls } = releaseContext(home, (command) => {
      if (command === 'uname') return ok('arm64');
      if (command === 'curl') return ok();
      return fail();
    });

    const report = await runActivation(releaseBinaries(CONFIG_KEY), context);

    expect(report.status).toBe('changed');
    expect(report.entries?.map((e) => e.status)).toEqual([
      'changed',
      'changed',
    ]);
    const curls = calls.filter((c) => c.command === 'curl');
    expect(curls).toHaveLength(2);
    // Transport is pinned to HTTPS on request and redirect, with a TLS floor.
    expect(curls[0]?.args.slice(0, 6)).toEqual([
      '-fsSL',
      '--proto',
      '=https',
      '--proto-redir',
      '=https',
      '--tlsv1.2',
    ]);
    expect(await readFile(join(home, '.cargo', 'bin', 'kpv'), 'utf8')).toBe(
      'curl',
    );
  },
);

sandboxTest('one binary failing still processes its siblings', async (home) => {
  await deployBinaries(home, PUBLIC_YAML);
  const { context } = releaseContext(home, (command, args) => {
    if (command === 'uname') return ok('arm64');
    if (command === 'curl') {
      return args.some((a) => a.includes('mx-darwin'))
        ? fail('404 not found')
        : ok();
    }
    return fail();
  });

  const report = await runActivation(releaseBinaries(CONFIG_KEY), context);

  expect(report.status).toBe('failed');
  expect(report.entries?.find((e) => e.key === 'kpv')?.status).toBe('changed');
  const mx = report.entries?.find((e) => e.key === 'mx');
  expect(mx?.status).toBe('failed');
  expect(mx?.error).toContain('404 not found');
});

sandboxTest(
  'an up-to-date binary is left unchanged and not re-fetched',
  async (home) => {
    await deployBinaries(home, PUBLIC_YAML);
    const binDir = join(home, '.cargo', 'bin');
    await mkdir(binDir, { recursive: true });
    await writeFile(join(binDir, 'kpv'), 'curl');
    await writeFile(join(binDir, 'mx'), 'curl');
    const { context, calls } = releaseContext(home, (command) => {
      if (command === 'uname') return ok('arm64');
      return fail();
    });

    const report = await runActivation(releaseBinaries(CONFIG_KEY), context);

    expect(report.status).toBe('unchanged');
    expect(report.entries?.every((e) => e.status === 'unchanged')).toBe(true);
    expect(calls.some((c) => c.command === 'curl')).toBe(false);
    // writeFile creates files without +x; installedMatches repairs the mode.
    expect((await stat(join(binDir, 'kpv'))).mode & 0o111).not.toBe(0);
    expect((await stat(join(binDir, 'mx'))).mode & 0o111).not.toBe(0);
  },
);

sandboxTest(
  'a missing lock file fails the activation with deploy-first guidance',
  async (home) => {
    await deployBinaries(home, PUBLIC_YAML, null);
    const { context, calls } = releaseContext(home, () => ok('arm64'));

    const report = await runActivation(releaseBinaries(CONFIG_KEY), context);

    expect(report.status).toBe('failed');
    expect(report.error).toContain('Release binaries lock');
    expect(calls.some((c) => c.command === 'curl')).toBe(false);
  },
);

sandboxTest(
  'a missing lock entry isolates to the affected binary',
  async (home) => {
    const partialLock = `
binaries:
  - name: kpv
    repo: akitorahayashi/kpv
    tag: v0.6.0
    assets:
      darwin-aarch64:
        sha256: ${CURL_SHA}
`.trimStart();
    await deployBinaries(home, PUBLIC_YAML, partialLock);
    const { context } = releaseContext(home, (command) => {
      if (command === 'uname') return ok('arm64');
      if (command === 'curl') return ok();
      return fail();
    });

    const report = await runActivation(releaseBinaries(CONFIG_KEY), context);

    expect(report.status).toBe('failed');
    expect(report.entries?.find((e) => e.key === 'kpv')?.status).toBe(
      'changed',
    );
    const mx = report.entries?.find((e) => e.key === 'mx');
    expect(mx?.status).toBe('failed');
    expect(mx?.error).toContain('Release lock is missing');
    expect(await readFile(join(home, '.cargo', 'bin', 'kpv'), 'utf8')).toBe(
      'curl',
    );
  },
);

sandboxTest(
  'a private binary is fetched with an authenticated gh download',
  async (home) => {
    await deployBinaries(
      home,
      `
binaries:
  - name: astm
    repo: asterismhq/asterism
    tag: v27.0.2
    private: true
`.trimStart(),
      `
binaries:
  - name: astm
    repo: asterismhq/asterism
    tag: v27.0.2
    assets:
      darwin-aarch64:
        sha256: ${GH_SHA}
`.trimStart(),
    );
    const { context, calls } = releaseContext(home, (command) => {
      if (command === 'uname') return ok('arm64');
      if (command === 'gh') return ok();
      return fail();
    });

    const report = await runActivation(releaseBinaries(CONFIG_KEY), context);

    expect(report.status).toBe('changed');
    expect(calls.some((c) => c.command === 'curl')).toBe(false);
    const gh = calls.find((c) => c.command === 'gh');
    expect(gh).toBeDefined();
    const output = gh?.args[gh.args.indexOf('--output') + 1] as string;
    expect(dirname(dirname(output))).toBe(
      await realpath(join(home, '.cargo', 'bin')),
    );
    expect(basename(dirname(output)).startsWith('.astm.')).toBe(true);
    expect(gh?.args).toEqual([
      'release',
      'download',
      'v27.0.2',
      '--repo',
      'asterismhq/asterism',
      '--pattern',
      'astm-darwin-aarch64',
      '--output',
      output,
      '--clobber',
    ]);
    expect(await readFile(join(home, '.cargo', 'bin', 'astm'), 'utf8')).toBe(
      'gh',
    );
  },
);

sandboxTest(
  'duplicate release names fail before architecture probing',
  async (home) => {
    await deployBinaries(
      home,
      `
binaries:
  - name: kpv
    repo: akitorahayashi/kpv
    tag: v0.6.0
  - name: KPV
    repo: akitorahayashi/kpv
    tag: v0.6.0
`.trimStart(),
    );
    const { context, calls } = releaseContext(home, () => ok());

    const report = await runActivation(releaseBinaries(CONFIG_KEY), context);

    expect(report.status).toBe('failed');
    expect(report.error).toContain('duplicate');
    expect(calls).toHaveLength(0);
  },
);

sandboxTest(
  'a failed download keeps the existing binary and removes temp files',
  async (home) => {
    const existing = join(home, '.cargo', 'bin', 'kpv');
    await mkdir(join(existing, '..'), { recursive: true });
    await writeFile(existing, 'old');
    await deployBinaries(
      home,
      `
binaries:
  - name: kpv
    repo: akitorahayashi/kpv
    tag: v0.6.0
`.trimStart(),
    );
    const { context } = releaseContext(home, (command) => {
      if (command === 'uname') return ok('arm64');
      if (command === 'curl') return fail('network down');
      return fail();
    });

    const report = await runActivation(releaseBinaries(CONFIG_KEY), context);

    expect(report.status).toBe('failed');
    expect(await readFile(existing, 'utf8')).toBe('old');
    expect(await readdir(join(home, '.cargo', 'bin'))).toEqual(['kpv']);
  },
);

sandboxTest(
  'a digest mismatch keeps the existing binary and removes temp files',
  async (home) => {
    const existing = join(home, '.cargo', 'bin', 'kpv');
    await mkdir(join(existing, '..'), { recursive: true });
    await writeFile(existing, 'old');
    await chmod(existing, 0o755);
    await deployBinaries(
      home,
      `
binaries:
  - name: kpv
    repo: akitorahayashi/kpv
    tag: v0.6.0
`.trimStart(),
      `
binaries:
  - name: kpv
    repo: akitorahayashi/kpv
    tag: v0.6.0
    assets:
      darwin-aarch64:
        sha256: ${GH_SHA}
`.trimStart(),
    );
    const { context } = releaseContext(home, (command) => {
      if (command === 'uname') return ok('arm64');
      if (command === 'curl') return ok();
      return fail();
    });

    const report = await runActivation(releaseBinaries(CONFIG_KEY), context);

    expect(report.status).toBe('failed');
    expect(report.entries?.[0]?.error).toContain('Digest mismatch for kpv');
    expect(await readFile(existing, 'utf8')).toBe('old');
    expect(await readdir(join(home, '.cargo', 'bin'))).toEqual(['kpv']);
  },
);
