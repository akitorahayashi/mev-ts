import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { errorMessage } from '../src/errors';
import { runWithCleanup } from '../src/host/cleanup-error';

type BuildStdio = 'inherit' | 'ignore';

interface BuildInvocation {
  readonly args: readonly string[];
  readonly cwd: string;
  readonly stdio: BuildStdio;
}

interface BuildOptions {
  readonly projectRoot: string;
  readonly outfile: string;
  readonly target?: string;
  readonly stdio?: BuildStdio;
  readonly runBuildCommand?: (invocation: BuildInvocation) => Promise<number>;
  readonly removeWorkspace?: (path: string) => Promise<void>;
}

async function runBunBuild(invocation: BuildInvocation): Promise<number> {
  const proc = Bun.spawn(['bun', ...invocation.args], {
    cwd: invocation.cwd,
    stderr: invocation.stdio,
    stdout: invocation.stdio,
  });
  return proc.exited;
}

async function runRequiredBuildCommand(
  invocation: BuildInvocation,
  runCommand: (invocation: BuildInvocation) => Promise<number>,
  failureLabel: string,
): Promise<void> {
  const code = await runCommand(invocation);
  if (code !== 0) {
    throw new Error(`${failureLabel} failed with exit code ${code}`);
  }
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
      const stdio = options.stdio ?? 'inherit';

      // Own the codegen-before-compile invariant here, so the compiled binary
      // never embeds a stale or missing asset registry regardless of caller.
      await runRequiredBuildCommand(
        {
          args: [resolve(options.projectRoot, 'scripts/generate-assets.ts')],
          cwd: options.projectRoot,
          stdio,
        },
        runCommand,
        'asset codegen',
      );
      await runRequiredBuildCommand(
        {
          args: [resolve(options.projectRoot, 'scripts/validate-assets.ts')],
          cwd: options.projectRoot,
          stdio,
        },
        runCommand,
        'asset validation',
      );

      const args = [
        'build',
        resolve(options.projectRoot, 'src/main.ts'),
        '--compile',
        // Playwright's regular Chrome path does not initialize its optional
        // BiDi-over-CDP mapper, which is not published with playwright-core.
        '--external',
        'chromium-bidi/*',
        '--outfile',
        options.outfile,
      ];
      if (options.target) args.push('--target', options.target);

      await runRequiredBuildCommand(
        { args, cwd: workspace, stdio },
        runCommand,
        'bun build',
      );
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
