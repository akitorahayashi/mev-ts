import { resolve } from 'node:path';

export type BuildStdio = 'inherit' | 'ignore';

export interface BuildInvocation {
  readonly args: readonly string[];
  readonly cwd: string;
  readonly stdio: BuildStdio;
}

export type RunBuildCommand = (invocation: BuildInvocation) => Promise<number>;

export interface BundleBuildOptions {
  readonly projectRoot: string;
  readonly outfile: string;
  /** Working directory of the compile step; codegen and validation run at the root. */
  readonly buildCwd: string;
  /** Emit a standalone executable (`--compile`) rather than a JavaScript bundle. */
  readonly compile: boolean;
  /** Bun `--target`; the release binary may cross-compile, the local install pins `bun`. */
  readonly target?: string;
  readonly stdio: BuildStdio;
  readonly runCommand: RunBuildCommand;
}

/** Compile the mev bundle through Bun's process spawner. */
export async function runBunBuild(
  invocation: BuildInvocation,
): Promise<number> {
  const proc = Bun.spawn(['bun', ...invocation.args], {
    cwd: invocation.cwd,
    stderr: invocation.stdio,
    stdout: invocation.stdio,
  });
  return proc.exited;
}

async function runRequired(
  invocation: BuildInvocation,
  runCommand: RunBuildCommand,
  failureLabel: string,
): Promise<void> {
  const code = await runCommand(invocation);
  if (code !== 0) {
    throw new Error(`${failureLabel} failed with exit code ${code}`);
  }
}

/**
 * Regenerate the asset registry, validate it, then compile the mev bundle. Owns
 * the codegen-before-compile invariant here, so no bundle embeds a stale or
 * missing asset registry regardless of the entry point that drives the build.
 */
export async function buildBundle(options: BundleBuildOptions): Promise<void> {
  await runRequired(
    {
      args: [resolve(options.projectRoot, 'scripts/generate-assets.ts')],
      cwd: options.projectRoot,
      stdio: options.stdio,
    },
    options.runCommand,
    'asset codegen',
  );
  await runRequired(
    {
      args: [resolve(options.projectRoot, 'scripts/validate-assets.ts')],
      cwd: options.projectRoot,
      stdio: options.stdio,
    },
    options.runCommand,
    'asset validation',
  );

  // browser-print.ts imports the pinned deep path mermaid/dist/mermaid.min.js.
  // Assert it resolves before bundling so a mermaid bump that relocates the dist
  // file fails here, naming the pin, instead of deep in the bundler. Resolve from
  // this repo's node_modules (where the pin lives), not the caller's projectRoot.
  try {
    Bun.resolveSync('mermaid/dist/mermaid.min.js', import.meta.dir);
  } catch {
    throw new Error(
      "Cannot resolve the pinned deep import 'mermaid/dist/mermaid.min.js' used by " +
        'src/internal/document/browser-print.ts. A mermaid version bump may have ' +
        'relocated the dist file; see the pin coupling note in docs/architecture.md.',
    );
  }

  const args = [
    'build',
    resolve(options.projectRoot, 'src/main.ts'),
    ...(options.compile ? ['--compile'] : []),
    // Playwright's regular Chrome path does not initialize its optional
    // BiDi-over-CDP mapper, which is not published with playwright-core.
    '--external',
    'chromium-bidi/*',
    '--outfile',
    options.outfile,
    ...(options.target ? ['--target', options.target] : []),
  ];

  await runRequired(
    { args, cwd: options.buildCwd, stdio: options.stdio },
    options.runCommand,
    'bun build',
  );
}
