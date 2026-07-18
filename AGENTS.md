# mev-ts

## Project Overview

`mev` is Local IaC for macOS, built with Bun and TypeScript. It deploys role-based configuration assets (dotfiles, tool configs) to a deploy store, installs required Homebrew packages, and activates them by creating symlinks or running idempotent host-command pipelines. Release installs distribute a single compiled binary; `bun run up` from a clone installs a Bun-targeted single-file JavaScript bundle as `mev`.

## Directory Structure

```
src/
  main.ts        CLI entry point
  errors.ts      Typed error hierarchy
  app/           Use-case orchestration (identity, config selection)
  assets/        Embedded config assets and asset registry (codegen: registry.generated.ts)
  brew/          Homebrew batch install via Brewfile
  cli/
    commands/    One class per command, enumerated in registry.ts; internal commands (hidden) share runInternalCommand
      config/    Config toggle commands built by defineConfigCommand (aliased `cf`)
    tty/         ANSI styling, string renderers (incl. table.ts, namespace-overview.ts), and the interactive toggle prompt
  duti/          duti file-association state probes and apply operations
  editor/        Editor extension list and install operations
  github/        GitHub release download
  host/          CommandRunner, Context, HostPath; parse.ts (parsed-unknown assertions), transaction.ts (atomic staging)
  identity/      Git identity scope enum and on-disk store
  internal/
    document/    Pandoc/Poppler conversion and browser PDF rendering
    gh/          GitHub CLI wrappers
    git/         Git wrappers; run.ts shares the step/capture helpers (LC_ALL-pinned)
  pipx/          pipx install, inject, and post-install operations
  provisioning/
    activation/  Activation DSL vocabulary, per-kind runners, reconcile envelope, manifest loader
    targets/     One file per provisioning target
scripts/
  generate-assets.ts  Asset codegen: walks src/assets/config/, emits registry.generated.ts
tests/                Integration tests for CLI, filesystem, subprocess, and network behavior
```

A module is promoted from `app/` into its own `src/<domain>/` directory only when a second use case needs it, or when it wraps an external dependency (a tool's protocol, wire format, or persisted file format) — see `identity/`, `pipx/`, `duti/`, `editor/`, `github/` for the latter.

## Testing

Unit tests are colocated as `*.test.ts` files next to source under `src/`; they verify pure logic with no filesystem, process, or network access. Integration tests live under `tests/`; they verify filesystem, CLI routing, subprocess, or network behavior. Sandbox conventions, fake-injection rules, and CI layout are in docs/testing.md.

## Core Concepts

### 3-Phase Provisioning

`runMake()` drives three sequential phases: deploy embedded assets into `~/.mev/roles/{role}/` (`deployRole()`), install missing Homebrew packages (`installPackages()`), then apply activations in declaration order (`runActivation()`). `overwrite` stages a replacement role before removing the old deploy, with best-effort rollback for in-process failures; otherwise existing deploys are skipped.

### Activation DSL

`activation/` is the internal DSL for provisioning work. Targets import factories from `activation/index.ts`; `dispatch.ts` routes each `Activation` kind to its runner. Two cross-cutting rules govern the kinds:

- Multi-item kinds (`defaults`, `duti`, `pipx`, `editorExtensions`, `release`) share the `reconcile.ts` envelope, which enforces per-item failure isolation structurally — a throwing item fails only itself.
- Kinds that drive an external tool delegate its protocol and state probes to a capability module under `src/<tool>/` (`pipx/`, `duti/`, `editor/`, `github/`). Capability modules accept a `Context` and import no activation type; activations may import capabilities, never the reverse.

See docs/architecture.md for the per-kind table and the reconcile/manifest mechanics.

### Provisioning Targets

Each target is a file in `provisioning/targets/` registered in `provisioning/registry.ts`. The registry test (`src/provisioning/registry.test.ts`) validates asset existence and selector uniqueness for every registered target, so adding a target needs no new test file.

### CLI

`main.ts` owns the clipanion `Cli` and registers the commands enumerated in `cli/commands/registry.ts` (the single registration source; namespace-help routing derives from their paths). Each command subclasses `Command`. `CommandLineError` (= `UsageError`) goes to stdout with usage. Commands that can transitively throw `AppError`/`ProvisioningError` wrap their execute body with `runReportingDomainErrors`, which prints `<name>: <message>` to stderr without stack or usage and returns exit code 1. Pure renderers stay unwrapped. `src/errors.ts` documents the `AppError`/`ProvisioningError`/`CommandLineError` taxonomy.

### Key Types

- `Context` — `{ home, overwrite, commands: CommandRunner, assets: AssetSource, basePath }`, injected through every provisioning call; `basePath` is the inherited PATH read once in `createContext`. `resolveHome()` performs the only other `process.env` read (HOME), and `bunCommandRunner` layers an explicit `env` over the ambient environment at spawn. Tests supply fakes via `tests/fixtures/`.
- `AssetRef` — `{ key }` where `key` is the embed path under `src/assets/config/` and doubles as the deploy store sub-path under `deployRoot` (`.mev/roles`, derived from `mevRoot`).
- `HostPath` — symbolic path resolved against `context.home` at apply time.
- `mevRoot` (`host/path.ts`, value `.mev`) — sole authority for the single root `~/.mev` under which mev owns every path it manages: the deploy store (`deployRoot`), the generated entities and selection manifests (coder, zed), identity state, and the symlink surface (`alias/`, `hooks/`, `rtk/`). Every mev-managed host path derives from it; none hardcodes `.mev` or a parallel root.
- `Target` / `MakePlan` — a target groups tags/aliases, role, packages, and `Activation[]`; `planMake()` merges selected targets into a deduplicated plan that preserves tag attribution.
- `Activation`, `StepReport`, `CommandScope` are defined in `activation/contract.ts`.

### Asset Codegen

`scripts/generate-assets.ts` inlines every file under `src/assets/config/` into `registry.generated.ts` (do not edit). It runs via the `pree`/`pretest`/`pretest:unit`/`pretest:integration`/`pretypecheck`/`precheck` hooks, and `buildMev` regenerates it before compiling so the binary never embeds a stale registry.

## Documentation Responsibilities

- AGENTS.md — source map, cross-cutting invariants, pointers. The orientation layer.
- README.md — user-facing CLI interface: commands, flags, setup.
- docs/architecture.md — design philosophy and detailed mechanics.
- docs/testing.md — test design and layer map.
- CONTRIBUTING.md — repository scope and the local task surface.
