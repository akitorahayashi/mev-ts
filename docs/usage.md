# Usage

Command reference for the `mev` CLI: every public subcommand, its aliases, and the behavior each produces.

## Provisioning

```bash
mev make git                   # Provision the git target
mev make git shell              # Provision multiple targets at once
```

`make` (alias `mk`) resolves each selector to a target, deploys embedded config assets to `~/.mev/roles/`, installs any missing Homebrew packages, then runs each activation idempotently. The repository config is the source of truth for declared outputs, so existing files, directories, or symlinks at those destinations are replaced by the current config. The exception is a config file its application rewrites at runtime, where only the declared keys are enforced and everything the app wrote is kept. Activations report `changed`, `unchanged`, or `failed` per item. Each run ends with a report that summarizes required action, phase counts, changed targets, and retry selectors. See docs/architecture/provisioning.md for the phase mechanics.

`--upgrade` (alias `-u`) additionally refreshes installed latest-assumed items in the selected targets: `latest`-declared pipx tools are upgraded to their latest release, `latest`-declared pnpm global packages and release binaries are re-resolved, and installed agent plugins are upgraded from their refreshed `main` marketplaces. Version-pinned entries are never touched, injected pipx dependencies stay presence-managed rather than upgraded, and upgrade mode does not affect target signatures or sync staleness. Installing a declared plugin and enabling it are not upgrade concerns: a plain `make` converges both.

```bash
mev create                      # Provision the full environment
mev sync                        # Apply changed full-setup targets
mev s                           # Alias for sync
```

`create` (alias `cr`) provisions the full environment by running every target except the optional ones through the same phases as `make`. Optional GUI casks are deferred; install them on demand with `mev make br-c`. `create --upgrade` (alias `-u`) applies the same upgrade mode as `make --upgrade` across the full run.

`sync` (alias `s`) scans the same non-optional target set and runs only targets whose declared packages, activation intent, or embedded assets changed since their last successful application, plus targets whose deployed role assets drifted. Successful target signatures are stored under `~/.mev/applied/`; optional targets remain explicit `make` operations. See docs/architecture/targets.md for the signature and staleness mechanics.

`sync --upgrade` (alias `-u`) applies upgrade mode only within the targets the scan selected; the selection itself is unchanged, so a synchronized environment still exits immediately without provisioning or network access. A deliberate full refresh of latest-assumed tools is `create -u` or `make <target> -u`.

## Repository Workspace

The non-optional `grove` target installs the `gv` release binary and materializes
the embedded repository catalog as the regular file `~/Desktop/grove.toml`.
During provisioning, stock `git@github.com:` repository URLs are rendered
through the host alias stored by `mev config ssh-host`; an absent store keeps
`github.com`.
Provisioning does not clone or update its declared repositories. After GitHub
SSH authentication, repository synchronization remains an explicit Grove
operation from the catalog root:

```bash
gh auth login --hostname github.com --git-protocol ssh --web
cd ~/Desktop
gv sync
```

The managed Zsh Git function routes an interactive `git clone ...` or
`g clone ...` invocation through `gv clone ...`; `command git clone ...`
remains the explicit native-Git path. Git global options before `clone`, such
as `git -C <directory> clone`, also remain native. The `git cl` alias preserves
its batch form, `git cl <url>... -- <git-clone-options>...`, and applies the
same options to each cache-backed clone. `git rf-cl` accepts the regular clone
arguments and runs `gv clone` from the repository's `references/` directory.
The interactive route reports how to install Grove and exits with status 127
when `gv` is unavailable.

## Listing Targets

```bash
mev list                        # Show all available provisioning targets
mev ls                           # Alias for list
```

## Config

```bash
mev config agents               # Toggle enabled AGENTS.md sections (alias: mev cf ag)
mev config skills                # Toggle enabled skills (alias: mev cf sk)
mev config zed                   # Toggle enabled Zed settings overrides (alias: mev cf zd)
mev config zed --clear           # Disable all Zed settings overrides
mev config ssh-host github-work  # Set this machine's GitHub SSH host alias (alias: mev cf sh)
```

`config` (alias `cf`) groups the three selection commands above; each opens an interactive multi-select over its catalog. `--clear` is available on all three (`config agents --clear`, `config skills --clear`, `config zed --clear`) and disables every entry without opening the prompt. `config ssh-host` takes one positional OpenSSH `Host` alias, invalidates the Grove applied marker, and stores the alias at `~/.mev/ssh-host`; the next `sync` renders the Grove catalog with that host. It does not install or update plugins. Catalog sources, manifest mechanics, SSH host resolution, and the Zed settings-merge algorithm are in docs/config.md.

## Git Identity

```bash
mev user                        # List git identity subcommands (alias: mev us)
mev user show                   # Show stored Git identities (personal + work)
mev user set                    # Configure identities interactively
mev switch personal             # Switch active Git identity (alias: mev sw)
mev switch work
```

`user` (alias `us`) groups the git identity subcommands. Identities are stored in `~/.mev/identity.json`. `switch` writes the selected name and email to the mutable `~/.gitconfig`; `make git` manages the separate static config at `~/.config/git/config`.

## Worktrees

```bash
git w-a feature/signup feature/likes   # One worktree per branch, beside the repository
git w-ls                               # List them by name, branch, and state
git w-mv feature-signup signup-v2      # Rename a worktree's directory
git w-rm feature-login                 # Remove worktrees, keeping their branches
git w-td -n                            # Preview what a tidy would remove
git w-td                               # Remove the ones whose pull request has merged
git w-p feature-signup                 # Print one worktree's path
wcd feature-signup                     # Change into it (shell function; wcd alone returns to the main worktree)
```

`w-a`, `w-ls`, `w-mv`, `w-rm`, `w-td`, and `w-p` are Git aliases for hidden `mev internal git worktree` commands; `wcd` is a shell function, because a Git alias runs in a subprocess and cannot move the caller. A worktree for branch `<branch>` is created as `<repo>-<branch with slashes replaced by dashes>` next to the main worktree, and every command derives that layout from the main worktree, so any of them may be run from any worktree.

`w-a` takes branch names. A branch that already exists is checked out, a branch that exists on exactly one remote is created tracking it, and any other name is created from HEAD. The request is validated in full before the first worktree is created, and a failure part-way through removes the worktrees and branches the run had already created. Creating a branch from HEAD also warns when HEAD is behind the default branch; that comparison is against the local remote-tracking ref, so it is only as current as the last fetch, and a repository with no origin draws no warning at all.

Each new worktree then receives the main worktree's ignored files — credentials, fetched dependencies, generated project files — so a fresh worktree needs no separate bootstrap. Paths matched by the global ignore list are left behind, which keeps `.DS_Store` and the like out even when the repository lists them in its own `.gitignore` as well. Whole ignored directories are carried as one unit, and the copy is an APFS clone, so a dependency tree costs metadata rather than its size; where cloning is unavailable the paths are copied normally and that is reported. The set is read from the main worktree and so describes its ignore rules rather than each new branch's, so a path the new branch tracks is left as checked out and named rather than overwritten. Carrying never fails the command: the worktrees are already usable, and any path that did not arrive is named.

`w-ls` adds a STATE column: `↑n`/`↓n` for commits ahead of or behind the upstream, `n dirty` for uncommitted changes, and the markers `(gone)`, `(locked)`, and `(prunable)`. `(gone)` means the branch's upstream has been deleted on the remote, which is what `w-td` acts on. A worktree with nothing to report leaves the column empty.

`w-mv`, `w-rm`, and `w-p` identify an existing worktree by its path, its branch, its `<suffix>`, or its directory name — the name `w-ls` displays is always accepted. An ambiguous name is refused rather than guessed; pass the path to settle it. Neither `w-mv` nor `w-rm` deletes a branch: `w-rm` names the branches left behind so they can be removed with `git branch -d`.

`w-td` fetches with `--prune`, removes every worktree whose branch tracked an origin branch that no longer exists, deletes those branches, and fast-forwards the main worktree's default branch. It never checks out, and it declines the fast-forward rather than failing when the main worktree is on another branch, is dirty, carries unpushed commits, or tracks something other than `origin/<default>`. Anything it will not remove is named with its reason: locked, prunable, dirty, the current directory, or an upstream outside `refs/remotes/origin/`.

Only origin is pruned, so only an origin upstream carries evidence this run gathered. A branch tracking a local branch, or one on a second remote, also reads as gone — from local state of an age this command has no way to establish — and is left alone.

A deleted upstream is circumstantial evidence of a merge, not proof — a pull request closed without merging leaves the same trace once its branch is deleted. Because the upstream ref is gone, unpushed commits can no longer be detected either, so a clean working tree is the only additional gate, and `branch -D` is required since a squash-merged branch reads as unmerged. Every deletion therefore prints the tip it discarded, with the `git branch <name> <sha>` that restores it.

`w-td --dry-run` (alias `-n`) reports the same decisions and takes none of them. It is the only argument `w-td` accepts. The `fetch --prune` still runs, because a deleted upstream is only visible after the prune and a preview computed from stale remote-tracking refs would describe a different repository than the real run.

Bare repositories are not supported.

## Document Conversion

```bash
mev make shell                  # Install aliases and conversion dependencies
md2pdf README.md                # Write README.pdf beside the input
md2pdf docs -o exported         # Convert a directory recursively
md2pdf notes.md --css print.css --margin-top 20mm
pdf2md report.pdf               # Extract UTF-8 text to report.md
```

`md2pdf` and `pdf2md` are shell aliases for hidden `mev internal document` commands. Directory conversion preserves the relative tree and defaults to `document_outputs` when no output directory is given. `pdf2md` extracts text and does not reconstruct semantic Markdown structure from a PDF. See docs/architecture/document.md for the Pandoc, Chrome, and Poppler rendering mechanics.

| Command | Flags |
|---|---|
| `md2pdf <input>` | `--output-dir`/`-o`, `--css`/`-c`, `--margin-top`, `--margin-right`, `--margin-bottom`, `--margin-left` |
| `pdf2md <input>` | `--output-dir`/`-o` |

## Global Flags

```
--help, -h     Show command help
--version      Print the binary version
```
