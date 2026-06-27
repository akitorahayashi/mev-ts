# mev-ts

## Project Overview

`mev` is Local IaC for macOS, built with Bun and TypeScript. It deploys role-based configuration assets (dotfiles, tool configs) to a deploy store, installs required Homebrew packages, and activates them by creating symlinks or running idempotent host-command pipelines. The CLI is distributed as a single compiled binary.

## Directory Structure

```
src/
  main.ts        CLI entry point
  errors.ts      Typed error hierarchy
  app/           Identity use-case orchestration
  assets/        Embedded config assets and asset registry (codegen: registry.generated.ts)
  brew/          Homebrew batch install via Brewfile
  cli/
    commands/    MakeCommand, CreateCommand, ListCommand, SwitchCommand, UserCommand; internal commands hidden from help
    tty/         ANSI styling, progress bar, TTY renderers
  duti/          duti file-association state probes and apply operations
  editor/        Editor extension list and install operations
  github/        GitHub release download
  host/          CommandRunner interface, Context assembly, HostPath resolution
  identity/      Git identity scope enum and on-disk store
  internal/
    gh/          GitHub CLI wrappers
    git/         Git wrappers
  pipx/          pipx install, inject, and post-install operations
  provisioning/
    activation/  Activation DSL vocabulary, per-kind runners, reconcile envelope, manifest loader
    targets/     One file per provisioning target
scripts/
  generate-assets.ts  Asset codegen: walks src/assets/config/, emits registry.generated.ts
tests/               Mirror of src/ layout; one test file per module boundary
```

## Core Concepts

### 3-Phase Provisioning

`runMake()` drives three sequential phases: deploy embedded assets into `~/.config/mev/roles/{role}/` (`deployRole()`), install missing Homebrew packages (`installPackages()`), then apply each activation concurrently (`runActivation()`). `overwrite` re-deploys a role from scratch; otherwise existing deploys are skipped.

### Activation DSL

`activation/` is the internal DSL for provisioning work. Targets import factories from `activation/index.ts`; `dispatch.ts` routes each `Activation` kind to its runner. Two cross-cutting rules govern the kinds:

- Multi-item kinds (`defaults`, `duti`, `pipx`, `editorExtensions`, `coderAgents`, `coderSkills`, `release`) share the `reconcile.ts` envelope, which enforces per-item failure isolation structurally — a throwing item fails only itself.
- Kinds that drive an external tool delegate its protocol and state probes to a capability module under `src/<tool>/` (`pipx/`, `duti/`, `editor/`, `github/`). Capability modules accept a `Context` and import no activation type; activations may import capabilities, never the reverse.

See docs/architecture.md for the per-kind table and the reconcile/manifest mechanics.

### Provisioning Targets

Each target is a file in `provisioning/targets/` registered in `provisioning/registry.ts`. The registry test validates asset existence and selector uniqueness for every registered target, so adding a target needs no new test file.

### CLI

`main.ts` owns the clipanion `Cli`. Each command subclasses `Command`. Error routing is the one non-obvious rule: `CommandLineError` (= `UsageError`) goes to stdout with usage; `AppError`/`ProvisioningError` go to stderr.

Human-facing command surfaces stay synchronized across public `src/cli/**` `static paths` and `package.json` `scripts`. When a public command path or alias is added, removed, or renamed, the matching `bun <script>` and `bun run <script>` entry is updated in the same change unless Bun reserves that name. Multi-segment public command paths are exposed through a flat script name that preserves the path order. Internal commands stay off the package script surface unless a repository-specific contract says otherwise.

### Key Types

- `Context` — `{ home, overwrite, commands: CommandRunner, assets: AssetSource }`, injected through every provisioning call. Tests supply fakes.
- `AssetRef` — `{ key }` where `key` is the embed path under `src/assets/config/` and doubles as the deploy store sub-path under `deployRoot` (`.config/mev/roles`, the sole authority).
- `HostPath` — symbolic path resolved against `context.home` at apply time.
- `Target` / `MakePlan` — a target groups tags/aliases, role, packages, and `Activation[]`; `planMake()` merges selected targets into a deduplicated plan that preserves tag attribution.
- `Activation`, `StepReport`, `CommandScope` are defined in `activation/contract.ts`.

### Asset Codegen

`scripts/generate-assets.ts` inlines every file under `src/assets/config/` into `registry.generated.ts` (do not edit). It runs via the `premev`/`prebuild`/`pretest`/`precheck` hooks.

## Documentation Responsibilities

- AGENTS.md — source map, cross-cutting invariants, pointers. The orientation layer.
- README.md — user-facing CLI interface: commands, flags, setup.
- docs/architecture.md — design philosophy and detailed mechanics.
- docs/testing.md — test design and layer map.
- CONTRIBUTING.md — repository scope and the local task surface.
