# Git Worktrees

The hidden Git commands expose a small worktree lifecycle through Git aliases
and the `wcd` shell function. This document records the layout and safety
invariants; command syntax is in [usage.md](../usage.md).

## Layout and creation

| Concern | Contract |
|---|---|
| Location | Linked worktrees are siblings of the main worktree. |
| Name | `<repo>-<branch with slashes replaced by dashes>`. |
| Layout source | The main worktree determines the repository family, regardless of the caller's current worktree. |
| Branch selection | Existing local branch is checked out; a branch on exactly one remote tracks it, matched against configured remote names so names containing `/` resolve; otherwise a new branch is created. |
| Start point | New branches start at `origin/<default>` with no upstream, regardless of the invoking worktree. `--from <ref>` starts them at that ref instead. |
| Fetch | `origin` is fetched when a requested branch is not local and `--from` is absent, so checking out local branches works offline. |
| Checkout | The tree is written after the worktree can reach the common directory's `git-crypt` state, because git-crypt reads its keys from the per-worktree git directory and its required filter otherwise fails the checkout. `post-checkout` hooks do not run. |
| Validation | All requested branches are validated before the first worktree is created. |
| Partial failure | Worktrees and branches created by the request are rolled back. |
| Bare repositories | Unsupported. |

## Carrying ignored files

Creating a worktree carries ignored paths from the main worktree so credentials,
dependencies, and generated files do not require a second bootstrap.

| Rule | Result |
|---|---|
| Repository or global ignore match | Carried. |
| `.tmp` | Linked rather than copied; see below. |
| Whole ignored directory | Carried as one path. |
| Existing tracked path in the new branch | The checked-out tree wins; the carried path is not written over it. |
| Clone unavailable | A regular copy is used and reported. |
| Carry failure | The worktree remains usable and missing paths are named. |

The carry set is read from the main worktree and applies to every new worktree;
branch-specific ignore rules do not alter that set. Global ignores are carried
because the global list mixes machine-local files a worktree needs, such as
`*.local` settings, with regenerable clutter such as `.DS_Store`, and no pattern
separates the two. Clones make the clutter cost metadata only.

## Shared `.tmp`

| Concern | Contract |
|---|---|
| Link | Each new worktree's `.tmp` is an absolute symlink to the main worktree's `.tmp`, which is created when absent. |
| Lifetime | Removing a worktree removes the link; the shared content stays in the main worktree. |
| Refusal | A `.tmp` tracked by the main worktree or the target tree, or a main `.tmp` that is not a directory, is refused before any worktree is created. |
| Ignore | The link must be ignored, which a `.tmp` pattern without a trailing slash satisfies. Otherwise the request is rolled back and the last matching rule is named. |

## Naming and mutation

| Operation | Contract |
|---|---|
| List | Shows name, branch, ahead/behind counts, dirty state, and `gone`, `locked`, or `prunable` markers. |
| Path | Prints the main worktree with no token, or resolves one existing worktree. |
| Move | Accepts path, branch, suffix, or directory name; refuses ambiguity and moving the main worktree. |
| Remove | Accepts the same selectors; removes worktrees but leaves their branches. The current, locked, and prunable worktrees are refused. |
| Relative path | Resolved from the caller's directory, although git runs aliases from the worktree top. |
| Selector failure | Names known candidates instead of guessing. |

## Tidy decisions

`w-td` prunes `origin`, then evaluates linked worktrees whose upstream is gone.
Only origin evidence is eligible; local or other-remote upstreams are not.

| Gate | Decision |
|---|---|
| Main worktree or default branch | Never remove. |
| Current, locked, prunable, dirty, or non-origin upstream | Skip and report the reason. |
| Linked worktree with a deleted origin upstream | Remove the worktree and its branch. |
| Main worktree fast-forward | Perform only when it is on the default branch, clean, and tracks `origin/<default>`. Otherwise decline with the reason. |
| `--dry-run` / `-n` | Report the same decisions and perform no removals; pruning still runs so the preview uses current origin state. |

Deleted upstream state is evidence of a remote branch removal, not proof of a
merged pull request. The clean/branch safety gates keep tidy from discarding
local work that cannot be recovered from the remote.

## Sources of truth

Layout, selectors, and carrying live under `src/internal/git/worktree/`; hidden
commands are under `src/cli/commands/internal/`. Boundary behavior is covered by
the worktree tests under `tests/internal/git/` and the CLI wrapper tests.
