import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { errorMessage } from '../src/errors';
import { runWithCleanup } from '../src/host/cleanup-error';
import {
  type BuildInvocation,
  type BuildStdio,
  buildBundle,
  runBunBuild,
} from './build-bundle';

interface BuildOptions {
  readonly projectRoot: string;
  readonly outfile: string;
  readonly target?: string;
  readonly stdio?: BuildStdio;
  readonly runBuildCommand?: (invocation: BuildInvocation) => Promise<number>;
  readonly removeWorkspace?: (path: string) => Promise<void>;
}

function parseArgs(args: readonly string[], projectRoot: string): BuildOptions {
  let outfile = 'dist/mev';
  let target: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--outfile') {
      outfile = args[index + 1] ?? '';
      index += 1;
    } else if (arg?.startsWith('--outfile=')) {
      outfile = arg.slice('--outfile='.length);
    } else if (arg === '--target') {
      target = args[index + 1] ?? '';
      index += 1;
    } else if (arg?.startsWith('--target=')) {
      target = arg.slice('--target='.length);
    } else {
      throw new Error(`Unknown build argument: ${arg}`);
    }
  }

  if (!outfile) throw new Error('--outfile requires a value');
  if (target === '') throw new Error('--target requires a value');

  return {
    projectRoot,
    outfile: isAbsolute(outfile) ? outfile : resolve(projectRoot, outfile),
    target,
  };
}

export async function buildMev(options: BuildOptions): Promise<void> {
  const workspace = await mkdtemp(join(tmpdir(), 'mev-build-'));
  const removeWorkspace =
    options.removeWorkspace ??
    ((path: string) => rm(path, { force: true, recursive: true }));
  const runCommand = options.runBuildCommand ?? runBunBuild;

  await runWithCleanup(
    async () => {
      await mkdir(dirname(options.outfile), { recursive: true });
      // Compile the release binary from an isolated workspace so Bun's compiler
      // work files never land in the project root.
      await buildBundle({
        projectRoot: options.projectRoot,
        outfile: options.outfile,
        buildCwd: workspace,
        compile: true,
        target: options.target,
        stdio: options.stdio ?? 'inherit',
        runCommand,
      });
    },
    () => removeWorkspace(workspace),
    `Failed to clean up build workspace ${workspace}.`,
  );
}

if (import.meta.main) {
  try {
    await buildMev(parseArgs(Bun.argv.slice(2), process.cwd()));
  } catch (error) {
    console.error(errorMessage(error));
    process.exit(1);
  }
}
