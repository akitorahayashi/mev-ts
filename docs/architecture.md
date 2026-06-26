# Architecture

## Overview

`mev` is a macOS provisioning CLI compiled to a standalone binary via `bun build --compile`. The binary embeds configuration assets (dotfiles, YAML configs) so no install-time file extraction is needed.

The execution model is three sequential phases: deploy role assets to the deploy store → install required Homebrew packages → activate each asset (symlink, defaults write, or host-command pipeline).

## Layer Map

```
src/
  cli/          argv parsing, exit code mapping, terminal rendering (clipanion)
  app/          identity use-case orchestration
  provisioning/ target DSL, activation engines, 3-phase orchestrator
  brew/         Homebrew install
  host/         CommandRunner, Context, HostPath
  identity/     Git identity scopes and on-disk store
  assets/       embedded config files and asset registry
  internal/     gh and git tool-boundary command implementations
  errors.ts     typed error hierarchy
```

## 3-Phase Provisioning (provisioning/run.ts)

`runMake()` drives three sequential phases per make request:

1. Deploy — `deployRole()` writes every embedded asset for the selected roles into `~/.config/mev/roles/{role}/`. Skips if already present unless `overwrite` is set, in which case the role directory is removed and rewritten so stale files never linger.
2. Install — `installPackages()` collects formulae, taps, and casks from all selected targets, deduped across targets. Runs `brew bundle check` per token and installs only missing ones.
3. Activate — `runActivation()` applies each activation at p-limit concurrency of 8. Activations within a target that depend on prior deploy success are blocked if the deploy failed.

## Activation DSL (provisioning/activation/)

The `activation/` module is the internal DSL for all provisioning operations. Targets declare what they want using factories exported from `activation/index.ts`; the runtime dispatches by `kind`.

```
activation/
  contract.ts   Activation union, ActivationReport, StepReport, CommandScope, Verb — pure types
  dispatch.ts   runActivation() switch, describeActivation(), blockedReport()
  reconcile.ts  ReconcileSpec/ReconcileStep envelope; reconcile() drives declare→steps→report
  manifest.ts   readDeployedManifest() with ENOENT-only not-found translation
  symlink.ts    'file' + 'tree' factories and runners
  defaults.ts   'defaults' factory and runner
  duti.ts       'duti' factory and runner
  pipx.ts       'pipx' factory and runner
  extensions.ts 'editorExtensions' factory and runner
  coder.ts      'coderAgents' + 'coderSkills' factories and runners
  command.ts    'command' factory and step execution engine
  release.ts    'release' factory and runner
  index.ts      public barrel
```

Ten activation kinds:

| Kind | Factory | What it does |
|---|---|---|
| `file` | `link(source, dest)` | Symlinks one deployed asset to a host path |
| `tree` | `linkTree(prefix, dest)` | Mirrors every asset under a prefix; prunes managed stale links |
| `defaults` | `applyDefaults(configKey)` | Reads a YAML list and runs `defaults write` per entry |
| `duti` | `applyDuti(configKey)` | Reads a YAML list of `{bundle_id, extension}` pairs; applies `duti -s` for each that differs |
| `pipx` | `applyPipx(configKey)` | Reconciles pipx-managed tools against a YAML manifest; installs, injects, and post-installs |
| `editorExtensions` | `installExtensions(command, configKey)` | Reconciles an editor's installed extensions against a JSON manifest |
| `coderAgents` | `coderAgents(sectionsPrefix, dests)` | Fans out embedded agent config sections into Coder workspace directories |
| `coderSkills` | `coderSkills(skillsPrefix, targetDirs)` | Fans out embedded skill files into Coder workspace directories |
| `command` | `runCommand({ label, reads?, steps })` | Runs an ordered, idempotent host-command pipeline |
| `release` | `releaseBinaries(binaries)` | Fetches versioned GitHub release binaries; skips if installed version matches |

### Reconcile Envelope

`reconcile.ts` provides the shared execution envelope used by all multi-item activation kinds (`defaults`, `duti`, `pipx`, `editorExtensions`, `coderAgents`, `coderSkills`, `release`). It enforces a structural error boundary at the per-item level rather than leaving it to each implementation:

- `declare()` — yields the set of items to process. A failure here aborts the whole activation. In plan mode, `reconcile` returns `changed` after `declare` without building or running steps.
- `steps(declared)` — builds one `ReconcileStep` per item. This phase runs shared probes (e.g. listing installed tools or extensions) before returning the per-item work. A failure here also aborts the whole activation.
- Per-item isolation — `executeStep` wraps each step's `run()` in a try/catch; a throwing step calls its `onError()` handler and yields a per-item `failed` report without interrupting siblings.
- Status aggregation — `failed` outranks `changed`; an empty declaration reports `unchanged`.

`manifest.ts` provides `readDeployedManifest()`, used by YAML-driven kinds. It translates only `ENOENT` into a labeled "deploy first" message, preserving the original error for all other codes so `EISDIR` or `EACCES` surfaces its real cause.

### Command Pipeline

`runCommand` is the activation kind for operations that require running host commands. Its key concepts:

- `reads` — asset keys whose content is loaded into the scope before any step runs (e.g. `.ruby-version`).
- `CommandScope` — `{ home, basePath, ref(name) }`. `ref` looks up a value by name (from `reads` or a prior `capture`) and throws `ProvisioningError` on a missing name so undefined arguments fail loudly.
- `steps` — ordered. Each step can declare:
  - `argv(scope)` — command to run
  - `env(scope)` — environment override layered over the inherited environment
  - `skipIf(scope)` — idempotency guard: `{ pathExists }` or `{ commandSucceeds }`. `commandSucceeds` guards run with the step's `env` so toolchain shims are on PATH.
  - `capture` — register `stdout.trim()` into scope for later steps
  - `changedWhen` — `'always' | 'never' | { stdoutContains } | { outputNotContains }` — classify a successful run. `outputNotContains` matches against combined stdout+stderr.

A failed step halts the pipeline. Skipped steps report `unchanged`. The overall status is `failed` if any step failed, `changed` if any step changed, otherwise `unchanged`.

## Provisioning Targets (provisioning/targets/)

Each target is a self-contained file registered in `provisioning/registry.ts`. A target owns:
- `name` and display description
- `tags` and `aliases` for selector resolution
- `role` — the asset namespace under `src/assets/config/`
- `packages` — Homebrew formulae, taps, and casks required before activation
- `activations` — ordered list of `Activation` values

The registry test (`tests/provisioning/registry.test.ts`) validates asset existence and selector uniqueness automatically for all registered targets. Adding a target does not require new test files.

## Asset Embedding (assets/)

Raw config files live under `src/assets/config/` keyed as `{role}/global/{filename}`. `scripts/generate-assets.ts` walks the tree and inlines every file's content as a string, emitting `assets/registry.generated.ts`. The content is embedded in the compiled binary; no per-file imports or filesystem access occur at runtime.

`assets/registry.ts` wraps the generated map as `AssetSource`. An unknown key throws `ProvisioningError`. `keysByPrefix` lets targets derive their file lists from the embedded set rather than enumerating them by hand.

`AssetRef` keys double as sub-paths under the deploy root (`~/.config/mev/roles/`), so the deployed filename preserves the original dotfile name without a separate mapping.

## Context (host/)

`Context` — `{ home, overwrite, commands: CommandRunner, assets: AssetSource }` — is assembled by `createContext()` and injected through every provisioning call. Tests supply a hand-built `Context` rather than calling `createContext`, eliminating the need to mock modules or spawn real processes.

`CommandRunner.run(command, args, options?)` accepts `CommandOptions { env?, cwd? }`. `env` is layered over the inherited environment via `{ ...Bun.env, ...options.env }`.

## Capability Modules

Several activation kinds delegate external-tool protocol and state detection to capability modules rather than implementing them inline. Capability modules own the external tool's protocol, output format, and platform-specific state probes. They accept a `Context` and import no activation types (`Activation`, `ActivationReport`, `StepReport`). Activation modules may import from capabilities; capabilities never import from `provisioning/activation/`.

| Directory | Capability |
|---|---|
| `pipx/` | `pipx list --json` parse; install, inject, and post-install operations |
| `duti/` | `duti -x` output parse; `duti -s` apply |
| `editor/` | `--list-extensions` parse; `--install-extension` |
| `github/` | GitHub release download via `curl` (public) or `gh release download` (private) |

## Identity (identity/)

The identity domain owns Git identity switching independently of the provisioning engine. `identity/scope.ts` is the authority for switchable scopes and their aliases. `identity/store.ts` persists a profile pair to `~/.config/mev/identity.json` via atomic temp-write + rename. `app/identity.ts` orchestrates the show/set/switch use cases.

## Deploy Store Layout

All deployed assets land at `~/.config/mev/roles/{key}`. The constant `deployRoot = '.config/mev/roles'` in `assets/ref.ts` is the sole authority for this path. Symlinks created by `file` and `tree` activations point into this store.
