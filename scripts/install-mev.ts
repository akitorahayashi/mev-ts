import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { errorMessage } from '../src/errors';
import { runWithCleanup } from '../src/host/cleanup-error';
import {
  type BuildInvocation,
  type BuildStdio,
  buildBundle,
  runBunBuild,
} from './build-bundle';

interface InstallOptions {
  readonly projectRoot: string;
  readonly installDir?: string;
  readonly stdio?: BuildStdio;
  readonly runBuildCommand?: (invocation: BuildInvocation) => Promise<number>;
}

const STAGING_PREFIX = '.mev-up-';

/**
 * Only entries older than this are swept. A prefix match alone would also
 * delete the live workspace of a concurrent install that has already run its
 * mkdtemp; no build approaches this age, so anything past it is a crash orphan.
 */
const STAGING_ORPHAN_AGE_MS = 60 * 60 * 1000;

function defaultInstallDir(): string {
  return process.env['MEV_INSTALL_DIR'] ?? join(homedir(), '.local', 'bin');
}

/**
 * Remove staging directories left by an earlier run. A crash between the
 * mkdtemp and its cleanup strands one in the install directory permanently,
 * where nothing else would ever notice it.
 */
async function pruneStaleStaging(installDir: string): Promise<void> {
  const entries = await readdir(installDir).catch(() => []);
  for (const name of entries) {
    if (!name.startsWith(STAGING_PREFIX)) continue;
    const path = join(installDir, name);
    const stats = await lstat(path).catch(() => null);
    if (stats && Date.now() - stats.mtimeMs < STAGING_ORPHAN_AGE_MS) continue;
    await rm(path, { force: true, recursive: true });
  }
}

export async function installLocalMev(
  options: InstallOptions,
): Promise<string> {
  const installDir = options.installDir ?? defaultInstallDir();
  await mkdir(installDir, { recursive: true });
  await pruneStaleStaging(installDir);
  const dest = join(installDir, 'mev');
  const stageDir = await mkdtemp(join(installDir, STAGING_PREFIX));
  const stageDest = join(stageDir, 'mev');

  await runWithCleanup(
    async () => {
      await buildBundle({
        projectRoot: options.projectRoot,
        outfile: stageDest,
        buildCwd: options.projectRoot,
        compile: false,
        target: 'bun',
        stdio: options.stdio ?? 'inherit',
        runCommand: options.runBuildCommand ?? runBunBuild,
      });

      await chmod(stageDest, 0o755);
      await rename(stageDest, dest);
    },
    () => rm(stageDir, { force: true, recursive: true }),
    `Failed to clean up install workspace ${stageDir}.`,
  );

  return dest;
}

async function install(): Promise<void> {
  const projectRoot = join(import.meta.dir, '..');
  const dest = await installLocalMev({ projectRoot });

  console.log(`Installed to ${dest}`);
}

if (import.meta.main) {
  try {
    await install();
  } catch (error) {
    console.error(errorMessage(error));
    process.exit(1);
  }
}
