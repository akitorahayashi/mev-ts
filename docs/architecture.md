# Architecture

## Overview

`mev` is a macOS provisioning CLI compiled to a standalone binary via `bun build --compile`. The binary embeds configuration assets (dotfiles) so no install-time file extraction is needed.

The execution model is: tag resolution → target lookup → resource graph → parallel inspect → selective apply → report.

## Layer Map

```
src/mev/
  cli/          argv parsing, exit code mapping, terminal rendering  (cac + hand-rolled dispatch)
  app/          use-case orchestration                               (runMake)
  config/       target DSL, tag/alias registry
  resources/    core contracts, graph, executor
  providers/    resource implementations per surface
  identity/     Git identity scopes and on-disk identity store
  assets/       embedded dotfiles, asset registry
  runtime/      live context construction
  internal/     gh and git tool-boundary command implementations
  errors.ts     typed error hierarchy
```

`cli/tty/` owns all terminal output, named for the TTY/non-TTY split that defines each component's behavior: ANSI style utilities (`style.ts`), outcome table (`outcomes.ts`), the `make` progress bar with a timer-driven spinner (`progress.ts`), the listr2-based concurrent live list (`livelist.ts`), the `list` table (`targetlist.ts`), the `id show` table (`identities.ts`), and the interactive line prompter (`prompt.ts`). Commands under `cli/commands/` hold no rendering logic; they wire cac and call into `cli/tty/`.

## Core Contracts (resources/model.ts)

`Resource` is the central abstraction. Every provisionable unit implements two methods:

- `inspect(context)` — read the live host, return `present | missing | diverged`
- `apply(context)` — write to the host, idempotently

`Context` is injected at the call site and carries `home`, `overwrite`, a `CommandRunner`, and an `AssetSource`. This makes every provider testable without real I/O.

`ConcurrencyGroup` controls how many resources of the same surface may apply simultaneously:

| Group | Limit | Reason |
|---|---|---|
| `homebrew` | 1 | Homebrew is not safe to drive in parallel |
| `git` | 1 | `git config` locking |
| `filesystem` | 8 | Independent paths; wide parallelism is safe |

## Graph (resources/graph.ts)

`buildGraph(resources)` normalizes a flat resource list before execution:

1. Deduplicates by `id` — the same resource referenced from two targets runs once.
2. Rejects missing dependencies — a declared `after` id that does not exist in the selected set fails fast at build time.
3. Detects dependency cycles via DFS before any I/O begins.

## Executor (resources/executor.ts)

`planGraph` — inspects all resources in parallel, returns what would change without applying anything.

`applyGraph` — inspects all resources in parallel, then drives a dependency-ordered apply loop:
- Resources whose dependencies are unsatisfied wait.
- Resources whose dependencies failed or were blocked become `blocked` without being attempted.
- Concurrency is capped per group via p-limit.

Both functions accept an optional `onProgress(report)` callback that fires as each resource resolves. The CLI layer uses it to drive the progress bar.

Outcomes: `unchanged | changed | failed | blocked`.

## Target DSL (config/target.ts, config/targets/)

A `Target` owns its name, tags, aliases, description, and the resources it contributes. The registry (`config/registry.ts`) is the single source of truth — tag/alias resolution, available-selector enumeration, and the `list` command all derive from it. Adding a target means registering it there; no parallel tables.

## Providers

Each provider creates `Resource` values from a higher-level description.

`providers/filesystem.ts` — `deployAsset`, `directory`, `symlink`, `linkTree`. Symlink refuses to replace an unmanaged file at the destination unless `context.overwrite` is set. `linkTree` mirrors a set of deployed assets into a directory as symlinks preserving their relative layout, and owns that directory's managed-link state: links pointing into the deploy root that are no longer expected are pruned, while unrelated user files are left untouched.

`providers/brew.ts` — `formula`. Groups formulae into a single Brewfile written to `tmpdir`, then drives `brew bundle check` (inspect) and `brew bundle install --no-upgrade` (apply) as one batch.

`providers/git.ts` — `config(name, value)`. Reads via `git config --global --get` (follows the `~/.config/git/config` symlink chain to honor deployed config). Writes via `git config --file ~/.gitconfig` (pin to the literal file, not the symlink, so the deployed asset is not rewritten).

## Identity (identity/)

The identity domain owns Git identity switching, independent of the provisioning engine. `identity/scope.ts` is the authority for the switchable scopes (`personal`, `work`) and their input aliases (`p`, `w`); canonical names and aliases derive from one map. `identity/store.ts` persists a `personal`/`work` pair to `~/.config/mev/identity.json` via an atomic temp-write + rename, and parses defensively (unknown or malformed entries become `null` rather than throwing). `app/identity.ts` orchestrates the three use cases — `showIdentity` reports the stored profiles alongside the identity Git currently has applied globally (classified as `matched`/`unmanaged`/`unset`), `setIdentity` persists collected inputs, and `switchIdentity` writes the chosen profile to the global Git config. Identity reads/writes the global config through `internal/git/config.ts` (`configGet`, `configSetGlobal`), distinct from the provider path that pins `--file ~/.gitconfig`.

## Asset Embedding (assets/)

Raw asset files live under `assets/files/` with their real deployed names (including leading dots). `scripts/generate-assets.ts` walks that tree and inlines every file's content as a string keyed by its path relative to `files/`, emitting `assets/registry.generated.ts`. The content is therefore embedded in the compiled binary as plain data, with no per-file imports or filesystem access at runtime. The asset directory is the single authority for what ships; codegen runs before build, test, and check.

`assets/registry.ts` wraps the generated map as `AssetSource` (an unknown key throws `ProvisioningError` rather than returning empty content) and exposes `assetKeysByPrefix` so targets derive their file lists from the embedded set rather than hand-enumerating them.

`AssetRef` keys double as sub-paths under the deploy root (`~/.config/mev/roles/`), so the deployed filename preserves the original dotfile name without a separate mapping.

## Runtime Context (runtime/)

`resolveHome` reads `HOME` from `process.env` (with `os.homedir()` as fallback) and is the single home-directory resolver, reused by both `createContext` and the identity commands. `createContext` assembles the live context from `resolveHome`, `bunCommandRunner`, and `embeddedAssets`. The `overwrite` flag flows from the CLI option.

`bunCommandRunner` spawns processes via `Bun.spawn` and captures stdout/stderr/exit code.

## CLI (cli/)

The main command surface uses `cac` and exposes the user-facing commands:

`make <tags...>` — resolves tags, builds the resource graph, and applies or plans it. The action handler calls `runMake` in `app/make.ts`, passing `onStart(total)` and `onProgress(report)` callbacks that drive the `cli/tty/progress.ts` bar. The bar runs a timer-driven spinner so the line keeps animating during a long apply, and advances the count on each completion; it stays silent on a non-TTY stream. After completion, `cli/tty/outcomes.ts` renders the full outcome table with ANSI colors.

`list` — formats and prints all registered targets in a three-column table (TARGET / TAGS / DESCRIPTION) via `cli/tty/targetlist.ts`, with ANSI colors from `cli/tty/style.ts`.

`id <action>` and `sw <scope>` — the Git identity surface. `id show` prints the stored profiles and the active scope via `cli/tty/identities.ts`; `id set` collects name/email pairs through `cli/tty/prompt.ts` and persists them; `sw <personal|work>` (aliases `p`/`w`) applies a stored profile to the global Git config. `id` is registered with a single `<action>` positional rather than multi-word subcommands because cac matches only single-word command names. The commands delegate to `app/identity.ts`.

`internal` — routes to `cli/internal.ts` via hand-rolled string dispatch rather than cac, because cac cannot parse multi-word subcommands combined with trailing variadic arguments and `--` separators. Internal commands are not shown in `mev --help`. Git subcommands (`clone`, `delete-branches`, `delete-submodule`) delegate to `internal/git/`. GitHub subcommands (`gh labels deploy`, `gh labels reset`) build concurrent items via `internal/gh/labels.ts` and render them with `cli/tty/livelist.ts` (listr2).

`runMake` in `app/make.ts` is the testable use-case entry point. It returns `MakeResult` with a `reports: readonly ResourceReport[]` field and a `failed` boolean; rendering is the CLI layer's responsibility.
