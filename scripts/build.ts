import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { throwWithCleanupError } from '../src/host/cleanup-error';

interface BuildOptions {
  readonly projectRoot: string;
  readonly outfile: string;
  readonly target?: string;
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
  let primary: unknown;

  try {
    await mkdir(dirname(options.outfile), { recursive: true });
    const args = [
      'build',
      resolve(options.projectRoot, 'src/main.ts'),
      '--compile',
      '--outfile',
      options.outfile,
    ];
    if (options.target) args.push('--target', options.target);

    const proc = Bun.spawn(['bun', ...args], {
      cwd: workspace,
      stderr: 'inherit',
      stdout: 'inherit',
    });
    const code = await proc.exited;
    if (code !== 0) {
      throw new Error(`bun build failed with exit code ${code}`);
    }
  } catch (error) {
    primary = error;
  }

  try {
    await rm(workspace, { force: true, recursive: true });
  } catch (cleanup) {
    if (primary !== undefined) {
      throwWithCleanupError(
        primary,
        cleanup,
        `Failed to clean up build workspace ${workspace}.`,
      );
    }
    throw cleanup;
  }
  if (primary !== undefined) throw primary;
}

if (import.meta.main) {
  try {
    await buildMev(parseArgs(Bun.argv.slice(2), process.cwd()));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
