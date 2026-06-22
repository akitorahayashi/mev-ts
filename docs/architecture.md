# Architecture

## Overview

`mev` is a macOS provisioning CLI compiled to a standalone binary via `bun build --compile`. The binary embeds configuration assets (dotfiles) so no install-time file extraction is needed.

The execution model is: tag resolution → feature lookup → resource graph → parallel inspect → selective apply → report.

## Layer Map

```
src/mev/
  cli/          argv parsing, exit code mapping          (cac)
  app/          use-case orchestration                   (runMake)
  config/       feature DSL, tag/alias registry
  resources/    core contracts, graph, executor
  providers/    resource implementations per surface
  assets/       embedded dotfiles, asset registry
  runtime/      live context construction
  output/       terminal report rendering
  errors.ts     typed error hierarchy
```

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

1. Deduplicates by `id` — the same resource referenced from two features runs once.
2. Rejects missing dependencies — a declared `after` id that does not exist in the selected set fails fast at build time.
3. Detects dependency cycles via DFS before any I/O begins.

## Executor (resources/executor.ts)

`planGraph` — inspects all resources in parallel, returns what would change without applying anything.

`applyGraph` — inspects all resources in parallel, then drives a dependency-ordered apply loop:
- Resources whose dependencies are unsatisfied wait.
- Resources whose dependencies failed or were blocked become `blocked` without being attempted.
- Concurrency is capped per group via an `inflight` counter; `Promise.race` advances the loop whenever a slot frees.

Outcomes: `unchanged | changed | failed | blocked`.

## Feature DSL (config/feature.ts, config/features/)

A `Feature` owns its name, tags, aliases, and the resources it contributes. The registry (`config/registry.ts`) is the single source of truth — tag/alias resolution, available-selector enumeration, and any future listing command all derive from it. Adding a feature means registering it there; no parallel tables.

## Providers

Each provider creates `Resource` values from a higher-level description.

`providers/filesystem.ts` — `deployAsset`, `directory`, `symlink`. Symlink refuses to replace an unmanaged file at the destination unless `context.overwrite` is set.

`providers/brew.ts` — `formula`. Groups formulae into a single Brewfile written to `tmpdir`, then drives `brew bundle check` (inspect) and `brew bundle install --no-upgrade` (apply) as one batch.

`providers/git.ts` — `config(name, value)`. Reads via `git config --global --get` (follows the `~/.config/git/config` symlink chain to honor deployed config). Writes via `git config --file ~/.gitconfig` (pin to the literal file, not the symlink, so the deployed asset is not rewritten).

## Asset Embedding (assets/)

Assets are imported with Bun's `with { type: 'file' }` syntax. Bun resolves these to paths both in development (source tree) and in the compiled binary (embedded). The asset registry (`assets/registry.ts`) maps string keys to those paths and implements `AssetSource`. An unknown key throws `ProvisioningError` rather than silently returning empty content.

`AssetRef` keys double as sub-paths under the deploy root (`~/.config/mev/roles/`), so the deployed filename preserves the original dotfile name without needing a separate mapping.

## Runtime Context (runtime/)

`createContext` reads `HOME` from `process.env` (with `os.homedir()` as fallback) and assembles the live context from `bunCommandRunner` and `embeddedAssets`. The `overwrite` flag flows from the CLI option.

`bunCommandRunner` spawns processes via `Bun.spawn` and captures stdout/stderr/exit code.

## CLI (cli/)

The command boundary uses `cac`. `--help` and `--version` are intercepted before `program.parse()` to avoid `process.exit(0)` terminating tests.

`make <tags...>` is a variadic command. Because cac spreads a variadic into separate positionals and appends the options object last, the action handler uses a rest-params signature (`...inputs`) and pops the trailing object to separate tags from options.

`runMake` in `app/make.ts` is the testable use-case entry point; the CLI handler delegates immediately to it and converts `MakeResult` to an exit code.
