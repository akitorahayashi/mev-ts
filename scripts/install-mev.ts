import { chmod, mkdir, mkdtemp, readdir, rename, rm } from 'node:fs/promises';
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
    if (name.startsWith(STAGING_PREFIX)) {
      await rm(join(installDir, name), { force: true, recursive: true });
    }
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
