# mev-ts

## Project Overview

`mev` is Local IaC for macOS, built with Bun and TypeScript. It treats this repository's config as the source of truth for personal machine setup, deploys role-based configuration assets (dotfiles, tool configs) to a deploy store, installs required Homebrew packages, and activates declared outputs by replacing them with symlinks or by running idempotent host-command pipelines. Release installs distribute a single compiled binary; `bun run up` from a clone installs a Bun-targeted single-file JavaScript bundle as `mev`.

## Directory Structure

```
src/
  main.ts        CLI entry point
  errors.ts      Typed error hierarchy
  app/           Use-case orchestration (identity and SSH host changes; config-toggle.ts, the interactive toggle flow layered over config-selection/)
  agent-plugin/  Claude Code/Codex marketplace catalogs, installed-plugin inventories, and install/enable operations
  assets/        Embedded config assets and asset registry (codegen: registry.generated.ts)
  brew/          Homebrew batch install via Brewfile
  coder/         Coder section/skill catalogs, manifests, and renderers
  cli/
    commands/    One class per command, enumerated in registry.ts; internal commands (hidden) share runInternalCommand
      config/    Config toggle commands built by defineConfigCommand plus GitHub SSH host configuration (aliased `cf`)
    tty/         ANSI styling, string renderers (incl. table.ts, namespace-overview.ts), transient-line.ts (animated-progress line over an injected stream), and the interactive toggle prompt
  config-selection/ Shared config-selection manifest parser/resolver
  defaults/      macOS defaults manifest parser and protocol helpers
  duti/          duti file-association state probes and apply operations
  editor/        Editor extension list and install operations
  git/           Git config and command helpers shared by app/internal commands
  github/        GitHub release download and the per-machine SSH host alias store
  grove/         Grove catalog parsing and per-machine SSH host rendering
  host/          CommandRunner, Context, HostPath; parse.ts (parsed-unknown assertions and labeled JSON framing, each taking the error class to raise), yaml.ts (YAML load/serialize), toml.ts (TOML load/serialize), json.ts (JSON-object load/serialize), jsonc.ts (JSONC load and comment-preserving edits), declared-merge.ts (declared-keys merge and structural equality for app-owned config files), transaction.ts (atomic staging and the swap-transaction envelope), atomic-file.ts (atomic write, write-if-changed), regular-file.ts (regular-file reconciliation), command-run.ts (subprocess step/capture, LC_ALL-pinned), https-download.ts (hardened curl download), managed-links.ts (shared symlink reconciler), deployed-file.ts (deploy-first read), task-pool.ts (bounded concurrency), cleanup-error.ts (cleanup-error composition)
  identity/      Git identity scope enum and on-disk store
  internal/
    document/    Pandoc/Poppler conversion and browser PDF rendering
    gh/          GitHub CLI wrappers
    git/         Git wrappers (branches, clone, submodule, worktree)
  pipx/          pipx install, inject, and post-install operations
  pnpm/          pnpm global package install and remove through the fnm runtime
  provisioning/
    activation/  Activation DSL vocabulary, the per-kind registry (kinds.ts), per-kind runners, reconcile envelope, manifest loader
    targets/     One file per provisioning target
    signature.ts Semantic target signature derived from packages, activation intent, and embedded assets
    applied.ts   Atomic `~/.mev/applied/{target}` successful-signature store
    scan.ts      Concurrent signature and deployed-role drift classification
  version-pin.ts The `latest`-versus-pin policy shared by pipx, pnpm, and release binaries
  zed/           Zed override catalog, selection manifest, and settings renderer
scripts/
  generate-assets.ts  Asset codegen: walks src/assets/config/, emits registry.generated.ts
tests/                Integration tests for CLI, filesystem, subprocess, and network behavior
```

A module is promoted from `app/` into its own `src/<domain>/` directory only when a second use case needs it, or when it wraps an external dependency (a tool's protocol, wire format, or persisted file format) — see `identity/`, `pipx/`, `duti/`, `editor/`, `github/` for the latter.

Supply-chain references distinguish trusted first-party sources from third-party
sources. GitHub Actions and Git-hosted dependencies owned by `akitorahayashi`
use reviewed major or release tags for convenient trusted maintenance updates.
First-party agent plugin marketplaces are the exception: their SSH sources
track `main` for missing-plugin installation, while installed plugins are
upgraded only by an explicit `--upgrade` run, never implicitly, and removed
only when the catalog explicitly lists them for uninstall. Enablement is not an
upgrade concern: a declared plugin converges on installed and enabled on every
run, since an installed-but-disabled plugin contributes nothing.
Third-party GitHub Actions use full commit SHAs with version comments, and
third-party Git-hosted dependencies use immutable full commits.

## Testing

Unit tests are colocated as `*.test.ts` files next to source under `src/`; they verify pure logic with no filesystem, process, or network access. Integration tests live under `tests/`; they verify filesystem, CLI routing, subprocess, or network behavior. Sandbox conventions, fake-injection rules, and CI layout are in docs/testing.md.

## Core Concepts

### 3-Phase Provisioning

`runMake()` protects target-declared mutable host state, then drives three sequential phases — `deployRole()`, `installPackages()`, `runActivation()` — in declaration order. See docs/architecture/provisioning.md for the phase mechanics and the preservation boundary.

### Activation DSL

`activation/` is the internal DSL for provisioning work. Targets import factories from `activation/index.ts`; `kinds.ts` maps each `Activation` kind to its handler, and dispatch, build-time asset validation, and the registry test are all lookups into it. Capability modules under `src/<tool>/` (`pipx/`, `pnpm/`, `duti/`, `editor/`, `agent-plugin/`, `github/`, `grove/`) own each external tool's protocol and accept a `Context`; activations may import capabilities, never the reverse.

See docs/architecture/activation.md for the per-kind table and the reconcile/manifest mechanics.

### Provisioning Targets

Each target is a file in `provisioning/targets/` registered in `provisioning/registry.ts`. The registry test (`src/provisioning/registry.test.ts`) validates asset existence and selector uniqueness for every registered target, so adding a target needs no new test file. See docs/architecture/targets.md for the target shape and how `make`/`create`/`sync` derive their selections from the registry.

### Semantic Sync

`sync` scans `fullSetupTargets()` and passes only stale targets to one `runMake()` call. Staleness is a signature mismatch or drift between embedded and deployed role assets. See docs/architecture/targets.md for the signature hashing mechanics and how command activations contribute their declarative intent to it.

### CLI

`main.ts` registers the commands enumerated in `cli/commands/registry.ts` (see Directory Structure above). Command dispatch, the `CommandLineError`/`AppError`/`ProvisioningError` exit-code mapping, and the error taxonomy are in docs/architecture/cli.md and `src/errors.ts`.

### Key Types

- `Context` — `{ home, commands: CommandRunner, assets: AssetSource, basePath, tmpRoot }`, injected through every provisioning call and assembled by `createContext()`; tests supply hand-built fakes via `tests/fixtures/` rather than calling it. See docs/architecture/host.md for the `basePath`/`tmpRoot`/env-read mechanics and `CommandRunner.run`'s contract.
- `AssetRef` — `{ key }` where `key` is the embed path under `src/assets/config/` and doubles as the deploy store sub-path under `deployRoot` (`.mev/roles`, derived from `mevRoot`).
- `HostPath` — symbolic path resolved against `context.home` at apply time.
- `mevRoot` (`host/path.ts`, value `.mev`) — sole authority for the single root `~/.mev` under which mev owns every path it manages: the deploy store (`deployRoot`), the generated entities and selection manifests (coder, zed), agent plugin source state, identity state, and the symlink surface (`alias/`, `hooks/`, `rtk/`). `host/path.ts` also exports `mevPath(...segments)`, the sole builder composing mev-owned sub-paths on `mevRoot`, so every mev-managed host path derives from it and no call site hardcodes the `.mev` literal or a parallel root.
- `Target` / `MakePlan` — a target groups its canonical name, aliases, role, packages, and `Activation[]`; `planMake()` merges selected targets into a deduplicated plan that preserves target-name attribution. See docs/architecture/targets.md for the full target shape and the `optional` flag's role in `create`/`sync` selection.
- `Activation`, `StepReport`, `CommandScope` are defined in `activation/contract.ts`.

### Asset Codegen

`registry.generated.ts` is generated by `scripts/generate-assets.ts` from `src/assets/config/` — do not hand-edit it. It regenerates via the `pree`/`pretest`/`pretest:unit`/`pretest:integration`/`pretypecheck`/`precheck` hooks, and `buildMev` regenerates it again before compiling, so the binary never embeds a stale registry. See docs/architecture/assets.md for the embedding format and the registry staleness check.

## Documentation Responsibilities

- AGENTS.md — source map, cross-cutting invariants, and pointers. The orientation layer.
- README.md — installation, local development setup, and a minimal usage teaser. The front door.
- docs/architecture/ — provisioning design and mechanics: the 3-phase engine, the activation DSL, targets, semantic sync, the CLI dispatch/error model, asset embedding, identity, and document conversion. See docs/architecture/README.md for the per-file index.
- docs/config.md — the `mev config` selection subsystem: catalogs, manifests, opt-in/opt-out polarity, and the Zed settings-merge algorithm.
- docs/usage.md — the complete command reference: every subcommand, alias, and flag, and the behavior each produces.
- docs/testing.md — test design and layer map.
- CONTRIBUTING.md — repository scope and the local task surface.
