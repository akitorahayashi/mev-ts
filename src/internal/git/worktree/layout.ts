import { basename, dirname, join } from 'node:path';

/**
 * Worktrees live as siblings of the main worktree, named `<repo>-<suffix>`.
 * The main worktree's path is the only input: `rev-parse --show-toplevel`
 * answers for the worktree the command was invoked from, so deriving from it
 * would place new worktrees next to whichever one the user happened to stand in.
 */
export interface Layout {
  readonly container: string;
  readonly repo: string;
}

export function layoutFor(mainPath: string): Layout {
  return { container: dirname(mainPath), repo: basename(mainPath) };
}

/**
 * macOS stores directory names decomposed, so a branch carrying a precomposed
 * accent reaches the porcelain output decomposed while the same text typed as a
 * token stays precomposed. Every comparison between the two runs through here.
 */
export function nfc(value: string): string {
  return value.normalize('NFC');
}

export function directoryName(layout: Layout, suffix: string): string {
  return `${layout.repo}-${suffix}`;
}

export function pathFor(layout: Layout, suffix: string): string {
  return join(layout.container, directoryName(layout, suffix));
}

/** `/` is legal in a branch name but not in a single path component. */
export function slug(branch: string): string {
  return branch.replaceAll('/', '-');
}

/** The `<suffix>` of a sibling worktree, or null when it is not one. */
export function suffixOf(layout: Layout, path: string): string | null {
  const prefix = nfc(`${layout.repo}-`);
  const name = nfc(basename(path));
  return name.startsWith(prefix) ? name.slice(prefix.length) : null;
}

/**
 * Worktrees outside the container keep their absolute path rather than being
 * relativized into a `../../` chain. The result doubles as an accepted token,
 * so anything shown here can be passed straight back to move or remove.
 */
export function displayName(layout: Layout, path: string): string {
  return dirname(path) === layout.container ? basename(path) : path;
}

export const NAME_MAX_BYTES = 255;

export function exceedsNameLimit(name: string): boolean {
  // Byte length, not code units: a CJK branch name reaches the filesystem's
  // limit at roughly a third of its character count.
  return new TextEncoder().encode(name).length > NAME_MAX_BYTES;
}

function hasForbiddenCharacter(branch: string): boolean {
  for (const character of branch) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
    if (' ~^:?*[\\'.includes(character)) return true;
  }
  return false;
}

/**
 * The constraint a branch name violates, or null when it is valid. Checked here
 * rather than through `git check-ref-format --branch`, which expands the
 * `@{-n}` previous-checkout syntax before validating and so accepts or rejects
 * `@{-1}` depending on the reflog — a validation result that changes with
 * unrelated state. Doing it locally also puts the filesystem constraints git
 * knows nothing about in the same place.
 */
export function branchNameProblem(branch: string): string | null {
  if (branch === '') return 'must not be empty';
  if (branch.startsWith('-')) return "must not start with '-'";
  if (hasForbiddenCharacter(branch)) {
    return 'must not contain a space, a control character, or any of ~^:?*[\\';
  }
  if (branch.includes('..')) return "must not contain '..'";
  if (branch.includes('@{')) return "must not contain '@{'";
  if (branch === '@') return "must not be '@'";
  if (branch === 'HEAD') return "must not be 'HEAD'";
  if (branch.endsWith('.')) return "must not end with '.'";
  const components = branch.split('/');
  if (components.some((component) => component === '')) {
    return 'must not have an empty path component';
  }
  if (components.some((component) => component.startsWith('.'))) {
    return "must not have a component starting with '.'";
  }
  if (components.some((component) => component.endsWith('.lock'))) {
    return "must not have a component ending with '.lock'";
  }
  return null;
}

/** The constraint a worktree name violates, or null when it is valid. */
export function suffixProblem(suffix: string): string | null {
  if (suffix === '') return 'must not be empty';
  if (suffix.startsWith('-')) return "must not start with '-'";
  if (suffix.includes('/') || suffix.includes('\\')) {
    return 'must not contain a path separator';
  }
  if (suffix === '.' || suffix === '..') return "must not be '.' or '..'";
  return null;
}
