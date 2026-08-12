import { expect } from 'bun:test';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
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

const CONFIG_KEY = 'rust-cli/binaries.yml';

interface FakeRelease {
  /** The tag `releases/latest` resolves to, per repository. */
  readonly latest?: Readonly<Record<string, string>>;
  /** The version an asset download writes, overriding the tag it was fetched at. */
  readonly installs?: Readonly<Record<string, string>>;
  /** Repositories whose asset download fails. */
  readonly missingAsset?: readonly string[];
}

const LATEST_URL = /github\.com\/([^/]+\/[^/]+)\/releases\/latest$/;
const ASSET_URL = /github\.com\/([^/]+\/[^/]+)\/releases\/download\/([^/]+)\//;

function tagVersion(tag: string): string {
  return tag.startsWith('v') ? tag.slice(1) : tag;
}

/**
 * A host where a release binary's bytes are the version it reports, so the
 * `--version` probe the runner relies on is answered from what a download
 * actually wrote rather than from a script of expected calls.
 */
function releaseContext(home: string, release: FakeRelease = {}) {
  const respond: Responder = async (command, args) => {
    if (command === 'uname') return ok('arm64');
    if (command === 'curl') {
      const output = args[args.indexOf('-o') + 1] as string;
      const url = args[args.length - 1] as string;
      const latest = LATEST_URL.exec(url);
      if (latest?.[1]) {
        // The resolve request reads `%{http_code}\t%{redirect_url}` off curl's
        // stdout; a repository with no releases responds 404 with no redirect.
        const tag = release.latest?.[latest[1]];
        if (!tag) return ok('404\t');
        return ok(`302\thttps://github.com/${latest[1]}/releases/tag/${tag}`);
      }
      const asset = ASSET_URL.exec(url);
      if (!asset?.[1] || !asset[2]) return fail(`unexpected url ${url}`);
      const [, repo, tag] = asset;
      if (release.missingAsset?.includes(repo)) return fail('404 not found');
      await writeFile(output, release.installs?.[repo] ?? tagVersion(tag));
      return ok();
    }
    // Anything else is a binary answering --version: its file holds the
    // version, and an absent file is the not-installed signal (code 127).
    try {
      const version = await readFile(command, 'utf8');
      return ok(`${basename(command)} ${version}\n`);
    } catch {
      return { code: 127, stdout: '', stderr: 'no such file' };
    }
  };
  return recordingContext({ home, assets: emptyAssets, respond });
}

async function deployBinaries(home: string, yaml: string): Promise<void> {
  const roleDir = join(home, '.mev', 'roles', 'rust-cli');
  await mkdir(roleDir, { recursive: true });
  await writeFile(join(roleDir, 'binaries.yml'), yaml);
}

function manifest(...entries: readonly (readonly [string, string, string])[]) {
  return `binaries:\n${entries
    .map(
      ([name, repo, tag]) =>
        `  - name: ${name}\n    repo: ${repo}\n    tag: ${tag}\n`,
    )
    .join('')}`;
}

async function install(
  home: string,
  name: string,
  version: string,
  mode = 0o755,
): Promise<string> {
  const binDir = join(home, '.cargo', 'bin');
  await mkdir(binDir, { recursive: true });
  const path = join(binDir, name);
  await writeFile(path, version, { mode });
  return path;
}

const PINNED = manifest(['kpv', 'akitorahayashi/kpv', 'v0.6.0']);
const LATEST = manifest(['kpv', 'akitorahayashi/kpv', 'latest']);

sandboxTest('a pinned binary that is absent is fetched', async (home) => {
  await deployBinaries(home, PINNED);
  const { context, calls } = releaseContext(home);

  const report = await runActivation(releaseBinaries(CONFIG_KEY), context);

  expect(report.status).toBe('changed');
  expect(report.entries?.[0]).toMatchObject({
    key: 'kpv',
    value: 'installed v0.6.0',
    status: 'changed',
  });
  expect(await readFile(join(home, '.cargo/bin/kpv'), 'utf8')).toBe('0.6.0');
  // Transport is pinned to HTTPS on request and redirect, with a TLS floor,
  // and a stalled server cannot hang provisioning indefinitely: the low-speed
  // pair aborts a transfer that dropped below 1 byte/s for 30s, which
  // --connect-timeout alone does not cover after the connection is up.
  // --fail-with-body (not -f) keeps an HTTP error's response on disk so the
  // failure reports the server's own explanation.
  const curl = calls.find((call) => call.command === 'curl');
  expect(curl?.args.slice(0, 16)).toEqual([
    '-sSL',
    '--fail-with-body',
    '--proto',
    '=https',
    '--tlsv1.2',
    '--connect-timeout',
    '30',
    '--retry',
    '2',
    '--retry-connrefused',
    '--proto-redir',
    '=https',
    '--speed-limit',
    '1',
    '--speed-time',
    '30',
  ]);
});

sandboxTest(
  'a pinned binary already reporting its tag is left alone without network',
  async (home) => {
    await deployBinaries(home, PINNED);
    await install(home, 'kpv', '0.6.0');
    const { context, calls } = releaseContext(home);

    const report = await runActivation(releaseBinaries(CONFIG_KEY), context);

    expect(report.status).toBe('unchanged');
    expect(report.entries?.[0]?.value).toBe('up to date');
    expect(calls.some((call) => call.command === 'curl')).toBe(false);
  },
);

sandboxTest(
  'a pinned binary reporting another version is replaced',
  async (home) => {
    await deployBinaries(home, PINNED);
    await install(home, 'kpv', '0.5.0');
    const { context } = releaseContext(home);

    const report = await runActivation(releaseBinaries(CONFIG_KEY), context);

    expect(report.entries?.[0]).toMatchObject({
      value: 'upgraded to v0.6.0',
      status: 'changed',
    });
    expect(await readFile(join(home, '.cargo/bin/kpv'), 'utf8')).toBe('0.6.0');
  },
);

sandboxTest(
  'a latest binary that is absent resolves its tag and installs',
  async (home) => {
    await deployBinaries(home, LATEST);
    const { context } = releaseContext(home, {
      latest: { 'akitorahayashi/kpv': 'v0.7.0' },
    });

    const report = await runActivation(releaseBinaries(CONFIG_KEY), context);

    expect(report.entries?.[0]).toMatchObject({
      value: 'installed v0.7.0',
      status: 'changed',
    });
    expect(await readFile(join(home, '.cargo/bin/kpv'), 'utf8')).toBe('0.7.0');
  },
);

sandboxTest(
  'an installed latest binary holds still without upgrade mode',
  async (home) => {
    await deployBinaries(home, LATEST);
    await install(home, 'kpv', '0.6.0');
    const { context, calls } = releaseContext(home, {
      latest: { 'akitorahayashi/kpv': 'v0.7.0' },
    });

    const report = await runActivation(releaseBinaries(CONFIG_KEY), context);

    expect(report.status).toBe('unchanged');
    expect(calls.some((call) => call.command === 'curl')).toBe(false);
    expect(await readFile(join(home, '.cargo/bin/kpv'), 'utf8')).toBe('0.6.0');
  },
);

sandboxTest(
  'upgrade mode re-resolves latest and installs the newer release',
  async (home) => {
    await deployBinaries(home, LATEST);
    await install(home, 'kpv', '0.6.0');
    const { context } = releaseContext(home, {
      latest: { 'akitorahayashi/kpv': 'v0.7.0' },
    });

    const report = await runActivation(releaseBinaries(CONFIG_KEY), context, {
      upgrade: true,
    });

    expect(report.entries?.[0]).toMatchObject({
      value: 'upgraded to v0.7.0',
      status: 'changed',
    });
    expect(await readFile(join(home, '.cargo/bin/kpv'), 'utf8')).toBe('0.7.0');
  },
);

sandboxTest(
  'upgrade mode resolves but does not download when latest is already installed',
  async (home) => {
    await deployBinaries(home, LATEST);
    await install(home, 'kpv', '0.7.0');
    const { context, calls } = releaseContext(home, {
      latest: { 'akitorahayashi/kpv': 'v0.7.0' },
    });

    const report = await runActivation(releaseBinaries(CONFIG_KEY), context, {
      upgrade: true,
    });

    expect(report.status).toBe('unchanged');
    const downloads = calls.filter(
      (call) =>
        call.command === 'curl' &&
        call.args.some((arg) => arg.includes('/releases/download/')),
    );
    expect(downloads).toHaveLength(0);
  },
);

sandboxTest(
  'a release whose asset disagrees with its tag leaves the previous binary in place',
  async (home) => {
    await deployBinaries(home, PINNED);
    const path = await install(home, 'kpv', '0.4.0');
    const { context } = releaseContext(home, {
      installs: { 'akitorahayashi/kpv': '0.5.0' },
    });

    const report = await runActivation(releaseBinaries(CONFIG_KEY), context);

    expect(report.status).toBe('failed');
    expect(report.entries?.[0]?.error).toContain(
      'reports version 0.5.0, expected 0.6.0',
    );
    expect(await readFile(path, 'utf8')).toBe('0.4.0');
  },
);

sandboxTest(
  'a rejected latest asset is not left to pass as up to date on the next run',
  async (home) => {
    await deployBinaries(home, LATEST);
    const { context } = releaseContext(home, {
      latest: { 'akitorahayashi/kpv': 'v0.7.0' },
      installs: { 'akitorahayashi/kpv': '0.5.0' },
    });
    const activation = releaseBinaries(CONFIG_KEY);

    expect((await runActivation(activation, context)).status).toBe('failed');

    // Nothing landed, so the shortcut that holds an installed latest binary
    // still has no binary to hold and the failure repeats rather than healing.
    const second = await runActivation(activation, context);
    expect(second.status).toBe('failed');
    expect(second.entries?.[0]?.error).toContain('expected 0.7.0');
  },
);

sandboxTest(
  'a binary whose --version is not <name> <version> fails loudly',
  async (home) => {
    await deployBinaries(home, PINNED);
    await install(home, 'kpv', 'unparseable version banner');
    const { context } = releaseContext(home);

    const report = await runActivation(releaseBinaries(CONFIG_KEY), context);

    expect(report.status).toBe('failed');
    expect(report.entries?.[0]?.error).toContain("is not '<name> <version>'");
  },
);

sandboxTest('a stripped execute bit is repaired in place', async (home) => {
  await deployBinaries(home, PINNED);
  const path = await install(home, 'kpv', '0.6.0', 0o644);
  const { context, calls } = releaseContext(home);

  const report = await runActivation(releaseBinaries(CONFIG_KEY), context);

  expect(report.status).toBe('unchanged');
  expect((await stat(path)).mode & 0o111).not.toBe(0);
  expect(calls.some((call) => call.command === 'curl')).toBe(false);
});

sandboxTest('one binary failing still processes its siblings', async (home) => {
  await deployBinaries(
    home,
    manifest(
      ['kpv', 'akitorahayashi/kpv', 'v0.6.0'],
      ['mx', 'akitorahayashi/mx', 'v3.1.0'],
    ),
  );
  const { context } = releaseContext(home, {
    missingAsset: ['akitorahayashi/mx'],
  });

  const report = await runActivation(releaseBinaries(CONFIG_KEY), context);

  expect(report.status).toBe('failed');
  expect(report.entries?.find((e) => e.key === 'kpv')?.status).toBe('changed');
  const mx = report.entries?.find((e) => e.key === 'mx');
  expect(mx?.status).toBe('failed');
  expect(mx?.error).toContain('404 not found');
});

sandboxTest(
  'a missing manifest fails the activation with deploy-first guidance',
  async (home) => {
    const { context, calls } = releaseContext(home);

    const report = await runActivation(releaseBinaries(CONFIG_KEY), context);

    expect(report.status).toBe('failed');
    expect(report.error).toContain('Release binaries manifest');
    expect(calls).toHaveLength(0);
  },
);

sandboxTest(
  'a repository with no latest release fails with its HTTP status',
  async (home) => {
    await deployBinaries(home, LATEST);
    const { context } = releaseContext(home);

    const report = await runActivation(releaseBinaries(CONFIG_KEY), context);

    expect(report.status).toBe('failed');
    expect(report.entries?.[0]?.error).toContain('HTTP 404');
  },
);

sandboxTest(
  'a latest-release redirect outside the repository fails as a typed error',
  async (home) => {
    await deployBinaries(home, LATEST);
    const { context } = recordingContext({
      home,
      tmpRoot: home,
      assets: emptyAssets,
      async respond(command) {
        if (command === 'uname') return ok('arm64');
        if (command === 'curl') {
          return ok('302\thttps://github.com/login?return_to=%2Fkpv');
        }
        return fail('not installed');
      },
    });

    const report = await runActivation(releaseBinaries(CONFIG_KEY), context);

    expect(report.status).toBe('failed');
    expect(report.entries?.[0]?.error).toContain('redirected to unusable');
  },
);

sandboxTest(
  'duplicate release names fail before architecture probing',
  async (home) => {
    await deployBinaries(
      home,
      manifest(
        ['kpv', 'akitorahayashi/kpv', 'v0.6.0'],
        ['KPV', 'akitorahayashi/kpv', 'v0.6.0'],
      ),
    );
    const { context, calls } = releaseContext(home);

    const report = await runActivation(releaseBinaries(CONFIG_KEY), context);

    expect(report.status).toBe('failed');
    expect(report.error).toContain('duplicate');
    expect(calls).toHaveLength(0);
  },
);
