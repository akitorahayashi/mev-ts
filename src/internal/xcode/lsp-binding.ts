import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AppError, CommandLineError, errorMessage } from '../../errors';
import { runWithCleanup } from '../../host/cleanup-error';
import {
  type CommandResult,
  type CommandRunner,
  formatCommandFailure,
} from '../../host/command';
import { runProcessStep } from '../../host/command-run';
import {
  isRecord,
  parseJsonLabeled,
  requireNonEmptyString,
  requireRecord,
} from '../../host/parse';

export class XcodeLspBindingError extends AppError {}

const xcodeLspBindingError = (message: string): Error =>
  new XcodeLspBindingError(message);

// Playgrounds app packages declare iOS products, and a Simulator build needs no
// code signing, so it works without the package's team being provisioned.
const PACKAGE_DESTINATION = 'generic/platform=iOS Simulator';

// Only Xcode's SwiftPM can load a manifest that imports AppleProductTypes;
// sweetpad and sourcekit-lsp both fail on it, so the import, not the `.swiftpm`
// directory name, selects the Xcode build path.
const PLAYGROUND_IMPORT = /^\s*import\s+AppleProductTypes\b/m;

// sourcekit-lsp prefers a buildServer.json over its own SwiftPM support, so a
// binding left behind in a package directory would pin it to an old build log.
const BINDING_FILES = ['buildServer.json', '.compile'] as const;

type XcodeProject =
  | { readonly kind: 'workspace' | 'project'; readonly name: string }
  | { readonly kind: 'playground' }
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
  if (!entries.includes('Package.swift')) {
    throw new XcodeLspBindingError(
      `${directory} contains no .xcworkspace, .xcodeproj, or Package.swift.`,
    );
  }
  const manifestPath = join(directory, 'Package.swift');
  let manifest: string;
  try {
    manifest = await readFile(manifestPath, 'utf8');
  } catch (error) {
    throw new XcodeLspBindingError(
      `Cannot read ${manifestPath}: ${errorMessage(error)}`,
    );
  }
  return { kind: PLAYGROUND_IMPORT.test(manifest) ? 'playground' : 'package' };
}

// A failing `--json` run still prints the envelope, whose error message is the
// readable part; raw output is the detail only when no envelope came back.
function sweetpadFailure(result: CommandResult): string {
  let envelope: unknown;
  try {
    envelope = JSON.parse(result.stdout);
  } catch {
    envelope = undefined;
  }
  const message =
    isRecord(envelope) && isRecord(envelope['error'])
      ? envelope['error']['message']
      : undefined;
  return typeof message === 'string' && message.trim() !== ''
    ? `sweetpad bsp init failed with code ${result.code}: ${message}`
    : formatCommandFailure('sweetpad bsp init failed', result);
}

async function bindThroughSweetpad(
  run: CommandRunner,
  directory: string,
  project: { readonly kind: 'workspace' | 'project'; readonly name: string },
  write: (message: string) => void,
): Promise<void> {
  const result = await run.run(
    'sweetpad',
    [
      '--json',
      '--non-interactive',
      'bsp',
      'init',
      `--${project.kind}`,
      project.name,
    ],
    { cwd: directory },
  );
  if (result.code === 127) {
    throw new XcodeLspBindingError(
      `sweetpad is not installed; run \`mev make sp\` first. ${result.stderr.trim()}`,
    );
  }
  if (result.code !== 0) {
    throw new XcodeLspBindingError(sweetpadFailure(result));
  }
  const label = 'sweetpad bsp init output';
  const envelope = requireRecord(
    parseJsonLabeled(result.stdout, label, xcodeLspBindingError),
    label,
    xcodeLspBindingError,
  );
  if (envelope['ok'] !== true) {
    throw new XcodeLspBindingError(
      `${label} reported failure: ${result.stdout.trim()}`,
    );
  }
  // sweetpad reports the path relative to its working directory.
  const bindingPath = resolve(
    directory,
    requireNonEmptyString(
      requireRecord(envelope['data'], `${label} data`, xcodeLspBindingError)[
        'buildServerJson'
      ],
      `${label} data.buildServerJson`,
      xcodeLspBindingError,
    ),
  );
  write(
    `Bound sourcekit-lsp to ${project.name} through sweetpad at ${bindingPath}; the editor builds and indexes it in the background.\n`,
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

async function bindPlayground(
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

/** Removes binding files from a package sourcekit-lsp builds itself. */
async function unbindPackage(
  directory: string,
  write: (message: string) => void,
): Promise<boolean> {
  const removed: string[] = [];
  for (const name of BINDING_FILES) {
    try {
      await unlink(join(directory, name));
      removed.push(name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new XcodeLspBindingError(
          `Cannot remove stale ${join(directory, name)}: ${errorMessage(error)}`,
        );
      }
    }
  }
  write('sourcekit-lsp builds Swift packages itself; no binding is needed.\n');
  if (removed.length > 0) {
    write(
      `Removed stale ${removed.join(' and ')} so the package no longer follows an old Xcode build.\n`,
    );
  }
  return removed.length > 0;
}

/**
 * Converge the sourcekit-lsp binding of a project directory so editors such as
 * Zed resolve symbols with Xcode's compiler flags instead of falling back to
 * macOS single-file analysis. Xcode workspaces and projects get a
 * `buildServer.json` from `sweetpad bsp init`, whose BSP server derives flags
 * from the project and builds on request, so background indexing needs no
 * manual build. Playgrounds app packages are built once with Xcode and parsed
 * by xcode-build-server, because their manifests import `AppleProductTypes`,
 * which only Xcode's SwiftPM can load. Other packages are left to sourcekit-lsp's
 * own SwiftPM support, with any earlier binding removed.
 */
export async function bindXcodeLsp(
  run: CommandRunner,
  request: XcodeLspBindingRequest,
  write: (message: string) => void,
): Promise<void> {
  const directory = resolve(request.directory);
  const project = await detectProject(directory);
  if (request.scheme !== undefined && project.kind !== 'playground') {
    throw new CommandLineError(
      '--scheme applies to a Playgrounds app package; sweetpad and sourcekit-lsp derive the targets of other projects themselves.',
    );
  }
  let changed: boolean;
  switch (project.kind) {
    case 'package':
      changed = await unbindPackage(directory, write);
      break;
    case 'playground':
      await bindPlayground(run, directory, request.scheme, write);
      changed = true;
      break;
    default:
      await bindThroughSweetpad(run, directory, project, write);
      changed = true;
  }
  if (changed) {
    write(
      'Restart the Swift language server in the editor to apply the change.\n',
    );
  }
}
