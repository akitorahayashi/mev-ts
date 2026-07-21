# mev-ts

## Project Overview

`mev` is Local IaC for macOS, built with Bun and TypeScript. It treats this repository's config as the source of truth for personal machine setup, deploys role-based configuration assets (dotfiles, tool configs) to a deploy store, installs required Homebrew packages, and activates declared outputs by replacing them with symlinks or by running idempotent host-command pipelines. Release installs distribute a single compiled binary; `bun run up` from a clone installs a Bun-targeted single-file JavaScript bundle as `mev`.

## Directory Structure

```
src/
  main.ts        CLI entry point
  errors.ts      Typed error hierarchy
  app/           Use-case orchestration (identity, config selection)
  assets/        Embedded config assets and asset registry (codegen: registry.generated.ts)
  brew/          Homebrew batch install via Brewfile
  coder/         Coder section/skill catalogs, manifests, and renderers
  cli/
    commands/    One class per command, enumerated in registry.ts; internal commands (hidden) share runInternalCommand
      config/    Config toggle commands built by defineConfigCommand (aliased `cf`)
    tty/         ANSI styling, string renderers (incl. table.ts, namespace-overview.ts), transient-line.ts (animated-progress line over an injected stream), and the interactive toggle prompt
  config-selection/ Shared config-selection manifest parser/resolver
  defaults/      macOS defaults manifest parser and protocol helpers
  duti/          duti file-association state probes and apply operations
  editor/        Editor extension list and install operations
  git/           Git config and command helpers shared by app/internal commands
  github/        GitHub release download
  host/          CommandRunner, Context, HostPath; parse.ts (parsed-unknown assertions), transaction.ts (atomic staging), command-run.ts (subprocess step/capture, LC_ALL-pinned), https-download.ts (hardened curl download), managed-links.ts (shared symlink reconciler), deployed-file.ts (deploy-first read)
  identity/      Git identity scope enum and on-disk store
  internal/
    document/    Pandoc/Poppler conversion and browser PDF rendering
    gh/          GitHub CLI wrappers
    git/         Git wrappers (branches, clone, submodule)
  pipx/          pipx install, inject, and post-install operations
  provisioning/
    activation/  Activation DSL vocabulary, per-kind runners, reconcile envelope, manifest loader
    targets/     One file per provisioning target
    signature.ts Semantic target signature derived from packages, activation intent, and embedded assets
    applied.ts   Atomic `~/.mev/applied/{target}` successful-signature store
    scan.ts      Concurrent signature and deployed-role drift classification
  zed/           Zed override catalog, selection manifest, and settings renderer
scripts/
  generate-assets.ts  Asset codegen: walks src/assets/config/, emits registry.generated.ts
tests/                Integration tests for CLI, filesystem, subprocess, and network behavior
```

A module is promoted from `app/` into its own `src/<domain>/` directory only when a second use case needs it, or when it wraps an external dependency (a tool's protocol, wire format, or persisted file format) — see `identity/`, `pipx/`, `duti/`, `editor/`, `github/` for the latter.

Supply-chain references distinguish trusted first-party sources from third-party
sources. GitHub Actions and Git-hosted dependencies owned by `akitorahayashi`
use reviewed major or release tags for convenient trusted maintenance updates.
Third-party GitHub Actions use full commit SHAs with version comments, and
third-party Git-hosted dependencies use immutable full commits.

## Testing

Unit tests are colocated as `*.test.ts` files next to source under `src/`; they verify pure logic with no filesystem, process, or network access. Integration tests live under `tests/`; they verify filesystem, CLI routing, subprocess, or network behavior. Sandbox conventions, fake-injection rules, and CI layout are in docs/testing.md.

## Core Concepts

### 3-Phase Provisioning

`runMake()` protects target-declared mutable host state, then drives three sequential phases: deploy embedded assets into `~/.mev/roles/{role}/` (`deployRole()`), install missing Homebrew packages (`installPackages()`), then apply activations in declaration order (`runActivation()`). Preservation runs before applied-state invalidation and role replacement. Deploys stage the selected role and replace it only when its contents or executable attributes drift; declared symlink destinations are replaced with the current repository-defined target.

### Activation DSL

`activation/` is the internal DSL for provisioning work. Targets import factories from `activation/index.ts`; `dispatch.ts` routes each `Activation` kind to its runner. Two cross-cutting rules govern the kinds:

- Multi-item kinds (`defaults`, `duti`, `pipx`, `editorExtensions`, `release`) share the `reconcile.ts` envelope, which enforces per-item failure isolation structurally — a throwing item fails only itself.
- Kinds that drive an external tool delegate its protocol and state probes to a capability module under `src/<tool>/` (`pipx/`, `duti/`, `editor/`, `github/`). Capability modules accept a `Context` and import no activation type; activations may import capabilities, never the reverse.

See docs/architecture.md for the per-kind table and the reconcile/manifest mechanics.

### Provisioning Targets

Each target is a file in `provisioning/targets/` registered in `provisioning/registry.ts`. The registry test (`src/provisioning/registry.test.ts`) validates asset existence and selector uniqueness for every registered target, so adding a target needs no new test file.

### Semantic Sync

`sync` scans `fullSetupTargets()` and passes only stale targets to one `runMake()` call. Staleness is a semantic target-signature mismatch or drift between embedded and deployed role assets; command activations are declarative and hashed — their argv, env, and `skipIf` are declarative token data included in the target signature, so a command edit flips the signature without a manual version counter. `runMake()` atomically records successful target signatures under `~/.mev/applied/`, so `make`, `create`, and `sync` share one applied-state boundary. Optional targets are never selected by sync.

### CLI

`main.ts` owns the clipanion `Cli` and registers the commands enumerated in `cli/commands/registry.ts` (the single registration source; namespace-help routing derives from their paths). Each command subclasses `Command`. `CommandLineError` (= `UsageError`) goes to stdout with usage. Commands that can transitively throw `AppError`/`ProvisioningError` wrap their execute body with `runReportingDomainErrors`, which prints `<name>: <message>` to stderr without stack or usage and returns exit code 1. Pure renderers stay unwrapped. `src/errors.ts` documents the `AppError`/`ProvisioningError`/`CommandLineError` taxonomy.

### Key Types

- `Context` — `{ home, commands: CommandRunner, assets: AssetSource, basePath, tmpRoot }`, injected through every provisioning call; `basePath` is the inherited PATH read once in `createContext`, and `tmpRoot` is the scratch root (defaulting to the system temp dir) that tests point at a sandbox. `resolveHome()` performs the only other `process.env` read (HOME), and `bunCommandRunner` layers an explicit `env` over the ambient environment at spawn. Tests supply fakes via `tests/fixtures/`.
- `AssetRef` — `{ key }` where `key` is the embed path under `src/assets/config/` and doubles as the deploy store sub-path under `deployRoot` (`.mev/roles`, derived from `mevRoot`).
- `HostPath` — symbolic path resolved against `context.home` at apply time.
- `mevRoot` (`host/path.ts`, value `.mev`) — sole authority for the single root `~/.mev` under which mev owns every path it manages: the deploy store (`deployRoot`), the generated entities and selection manifests (coder, zed), identity state, and the symlink surface (`alias/`, `hooks/`, `rtk/`). `host/path.ts` also exports `mevPath(...segments)`, the sole builder composing mev-owned sub-paths on `mevRoot`, so every mev-managed host path derives from it and no call site hardcodes the `.mev` literal or a parallel root.
- `Target` / `MakePlan` — a target groups its canonical name, aliases, role, packages, optional pre-deploy preservation, and `Activation[]`; `planMake()` merges selected targets into a deduplicated plan that preserves target-name attribution.
- `Activation`, `StepReport`, `CommandScope` are defined in `activation/contract.ts`.

### Asset Codegen

`scripts/generate-assets.ts` inlines every file under `src/assets/config/` into `registry.generated.ts` (do not edit). It runs via the `pree`/`pretest`/`pretest:unit`/`pretest:integration`/`pretypecheck`/`precheck` hooks, and `buildMev` regenerates it before compiling so the binary never embeds a stale registry.

## Documentation Responsibilities

- AGENTS.md — source map, cross-cutting invariants, pointers. The orientation layer.
- README.md — user-facing CLI interface: commands, flags, setup.
- docs/architecture.md — design philosophy and detailed mechanics.
- docs/testing.md — test design and layer map.
- CONTRIBUTING.md — repository scope and the local task surface.
