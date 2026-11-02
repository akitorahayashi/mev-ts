import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AppError, CommandLineError, errorMessage } from '../../errors';
import { runWithCleanup } from '../../host/cleanup-error';
import type { CommandRunner } from '../../host/command';
import { runProcessStep } from '../../host/command-run';

export class XcodeLspBindingError extends AppError {}

const xcodeLspBindingError = (message: string): Error =>
  new XcodeLspBindingError(message);

// Playgrounds app packages declare iOS products, and a Simulator build needs no
// code signing, so it works without the package's team being provisioned.
const PACKAGE_DESTINATION = 'generic/platform=iOS Simulator';

type XcodeProject =
  | { readonly kind: 'workspace' | 'project'; readonly name: string }
  | { readonly kind: 'package' };

export interface XcodeLspBindingRequest {
  readonly directory: string;
  readonly scheme?: string;
}

async function detectProject(directory: string): Promise<XcodeProject> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    throw new XcodeLspBindingError(
      `Cannot read ${directory}: ${errorMessage(error)}`,
    );
  }
  for (const kind of ['workspace', 'project'] as const) {
    const names = entries.filter((entry) =>
      entry.endsWith(kind === 'workspace' ? '.xcworkspace' : '.xcodeproj'),
    );
    if (names.length > 1) {
      throw new XcodeLspBindingError(
        `${directory} contains multiple Xcode ${kind}s (${names.join(', ')}); bind from a directory with exactly one.`,
      );
    }
    const [name] = names;
    if (name !== undefined) return { kind, name };
  }
  if (entries.includes('Package.swift')) return { kind: 'package' };
  throw new XcodeLspBindingError(
    `${directory} contains no .xcworkspace, .xcodeproj, or Package.swift.`,
  );
}

async function resolvePackageScheme(
  run: CommandRunner,
  directory: string,
): Promise<string> {
  const listing = await runProcessStep(
    run,
    'xcodebuild',
    ['-list', '-json'],
    'xcodebuild -list failed',
    { cwd: directory, raise: xcodeLspBindingError },
  );
  let schemes: unknown;
  try {
    schemes = JSON.parse(listing.stdout)?.workspace?.schemes;
  } catch (error) {
    throw new XcodeLspBindingError(
      `xcodebuild -list printed invalid JSON: ${errorMessage(error)}`,
    );
  }
  if (!Array.isArray(schemes) || schemes.length === 0) {
    throw new XcodeLspBindingError(
      `xcodebuild -list reported no schemes for ${directory}.`,
    );
  }
  if (schemes.length > 1) {
    throw new CommandLineError(
      `Multiple schemes found (${schemes.join(', ')}); pass one with --scheme.`,
    );
  }
  return String(schemes[0]);
}

async function bindPackage(
  run: CommandRunner,
  directory: string,
  requestedScheme: string | undefined,
  write: (message: string) => void,
): Promise<void> {
  const scheme =
    requestedScheme ?? (await resolvePackageScheme(run, directory));
  write(`Building ${scheme} for the iOS Simulator...\n`);
  const build = await run.run(
    'xcodebuild',
    ['-scheme', scheme, '-destination', PACKAGE_DESTINATION, 'build'],
    { cwd: directory },
  );
  if (build.code !== 0) {
    const errors = `${build.stdout}\n${build.stderr}`
      .split('\n')
      .filter((line) => line.includes('error:'));
    throw new XcodeLspBindingError(
      `xcodebuild failed with code ${build.code}: ${errors.join('\n') || 'no compiler error reported'}`,
    );
  }

  const logDirectory = await mkdtemp(join(tmpdir(), 'mev-xcode-lsp-'));
  await runWithCleanup(
    async () => {
      const log = join(logDirectory, 'build.log');
      await writeFile(log, build.stdout);
      await runProcessStep(
        run,
        'xcode-build-server',
        ['parse', log],
        'xcode-build-server parse failed',
        { cwd: directory, raise: xcodeLspBindingError },
      );
    },
    () => rm(logDirectory, { recursive: true, force: true }),
    `Failed to remove build log directory ${logDirectory}.`,
  );
  write(
    `Bound sourcekit-lsp to the ${scheme} build; rerun after adding files or changing build settings.\n`,
  );
}

async function bindXcodeBuildLog(
  run: CommandRunner,
  directory: string,
  project: { readonly kind: 'workspace' | 'project'; readonly name: string },
  scheme: string | undefined,
  write: (message: string) => void,
): Promise<void> {
  await runProcessStep(
    run,
    'xcode-build-server',
    [
      'config',
      `-${project.kind}`,
      project.name,
      ...(scheme === undefined ? [] : ['-scheme', scheme]),
    ],
    'xcode-build-server config failed',
    { cwd: directory, raise: xcodeLspBindingError },
  );
  write(
    `Bound sourcekit-lsp to the latest Xcode build of ${project.name}; build in Xcode to refresh compiler flags.\n`,
  );
}

/**
 * Write `buildServer.json` into the project directory so sourcekit-lsp resolves
 * symbols with Xcode's compiler flags instead of falling back to macOS
 * single-file analysis. Xcode projects follow Xcode's build logs; packages are
 * built once, because Playgrounds app manifests import `AppleProductTypes`,
 * which only Xcode's SwiftPM can load.
 */
export async function bindXcodeLsp(
  run: CommandRunner,
  request: XcodeLspBindingRequest,
  write: (message: string) => void,
): Promise<void> {
  const directory = resolve(request.directory);
  const project = await detectProject(directory);
  if (project.kind === 'package') {
    await bindPackage(run, directory, request.scheme, write);
  } else {
    await bindXcodeBuildLog(run, directory, project, request.scheme, write);
  }
  write(
    'Restart the Swift language server in the editor to apply the binding.\n',
  );
}
