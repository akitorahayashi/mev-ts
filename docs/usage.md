# Usage

Command reference for the public `mev` CLI, its aliases, and its user-visible
behavior.

## Provisioning

| Command | Effect |
|---|---|
| `mev make <target...>` (`mk`) | Deploy selected roles, install missing packages, and activate them. |
| `mev create` (`cr`) | Provision every registered non-optional target. |
| `mev sync` (`s`) | Apply only stale non-optional targets. |
| `mev list` (`ls`) | List registered targets. |

```bash
mev make git
mev make git shell
mev create
mev sync
```

Provisioning reports `changed`, `unchanged`, or `failed` activation items and a
run summary. App-owned configuration files enforce declared keys while keeping
application-written keys; other declared destinations converge to the current
repository configuration. See [provisioning.md](architecture/provisioning.md)
for phase boundaries.

### Upgrade

`--upgrade` (`-u`) refreshes latest-assumed items: `make` and `create` apply it
to their selected target set, while `sync` applies it only to targets already
selected as stale.

Upgrade does not change target signatures or widen sync selection. Pinned entries
remain untouched, and a plain provisioning run installs and enables declared
agent plugins without requiring upgrade mode.

## Repository workspace

| Command | Effect |
|---|---|
| `mev make grove` | Installs Grove and materializes `~/Desktop/grove.toml`. |
| `mev config ssh-host <alias>` | Stores the per-machine GitHub SSH host for the next sync. |
| `gv sync` | Synchronizes repositories from the catalog after GitHub authentication. |
| `git clone ...` / `g clone ...` | Uses the Grove clone cache from the managed interactive shell function. |
| `command git clone ...` | Uses native Git explicitly. |
| `git cl <url>... -- <options>...` | Batch-clones URLs with shared clone options. |
| `git rf-cl <clone arguments>` | Clones from the repository's `references/` directory through Grove. |

Provisioning does not clone or update repositories. If Grove is unavailable, the
interactive clone route reports how to install it and exits with status 127.

```bash
gh auth login --hostname github.com --git-protocol ssh --web
cd ~/Desktop
gv sync
```

## Listing targets

```bash
mev list
mev ls
```

## Config

| Command | Effect |
|---|---|
| `mev config agents` (`cf ag`) | Toggle AGENTS.md sections. |
| `mev config skills` (`cf sk`) | Toggle coder skills. |
| `mev config zed` (`cf zd`) | Toggle Zed settings overrides. |
| `mev config <surface> --clear` | Disable every entry on the selected surface. |
| `mev config ssh-host <alias>` (`cf sh`) | Store a valid OpenSSH host alias and invalidate affected sync state. |

Selection commands use an interactive multi-select unless `--clear` is given.
Catalog and manifest semantics are in [config.md](config.md).

## Git identity

| Command | Effect |
|---|---|
| `mev user` (`us`) | List identity subcommands. |
| `mev user show` | Show stored personal and work identities. |
| `mev user set` | Configure identities interactively. |
| `mev switch personal` / `work` (`sw`) | Write the selected identity to `~/.gitconfig`. |

`make git` manages the static `~/.config/git/config`; switching manages the
mutable overlay.

## Worktrees

| Command | Effect |
|---|---|
| `git w-a <branch...>` | Add worktrees. |
| `git w-ls` | List worktrees and state. |
| `git w-mv <worktree> <suffix>` | Move a linked worktree. |
| `git w-rm <worktree...>` | Remove linked worktrees and keep their branches. |
| `git w-td [-n]` | Tidy worktrees whose origin branches were deleted; `-n` previews. |
| `git w-p [worktree]` | Print a worktree path. |
| `wcd [worktree]` | Change to a worktree; with no argument, return to the main worktree. |

Worktree layout, selectors, carried ignored files, and tidy safety gates are in
[architecture/worktrees.md](architecture/worktrees.md).

## Document conversion

| Command | Effect |
|---|---|
| `md2pdf <input>` | Convert a file or directory to PDF. |
| `pdf2md <input>` | Extract UTF-8 text to Markdown. |

```bash
mev make shell
md2pdf README.md
md2pdf docs -o exported
md2pdf notes.md --css print.css --margin-top 20mm
pdf2md report.pdf
```

| Command | Options |
|---|---|
| `md2pdf` | `--output-dir`/`-o`, `--css`/`-c`, and four margin options |
| `pdf2md` | `--output-dir`/`-o` |

Directory conversion preserves the relative tree and defaults to the
`document_outputs` directory when no output directory is supplied. `pdf2md`
extracts text and does not infer semantic Markdown structure. See
[document.md](architecture/document.md) for conversion boundaries.

## Global flags

| Flag | Effect |
|---|---|
| `--help`, `-h` | Show command help. |
| `--version` | Print the binary version. |
