# mev-ts

## Project Overview

`mev` is a macOS development environment provisioning CLI built with Bun and TypeScript. It deploys role-based configuration assets (dotfiles, tool configs) to a deploy store, installs required Homebrew packages, and activates them by creating symlinks into host paths. The CLI is distributed as a single compiled binary.

## Directory Structure

```
src/
  main.ts                     Entry point — Cli setup, command registration, runCommandLine()
  errors.ts                   CommandLineError (= clipanion UsageError), AppError, ProvisioningError
  app/
    identity.ts               User identity resolution (git config + gh auth)
  assets/
    files/                    Embedded config assets, keyed as role/scope/filename
    ref.ts                    AssetRef type + deploy store path helpers
    registry.ts               AssetSource interface + embeddedAssets implementation
    registry.generated.ts     Codegen output — asset key→content map (do not edit)
  brew/
    install.ts                Homebrew batch install via Brewfile; per-token hooks
  cli/
    commands/
      make.ts                 MakeCommand — apply provisioning for one or more tags
      list.ts                 ListCommand — list available targets
      switch.ts               SwitchCommand — switch active Git identity
      user.ts                 UserCommand — show or configure Git identities
      internal/               Internal-use commands, hidden from main help
        git-clone.ts          InternalGitCloneCommand
        git-delete-branches.ts InternalGitDeleteBranchesCommand
        git-delete-submodule.ts InternalGitDeleteSubmoduleCommand
        gh-labels-deploy.ts   InternalGhLabelsDeployCommand
        gh-labels-reset.ts    InternalGhLabelsResetCommand
    tty/
      style.ts                makeStyle(isTTY) — ANSI color helpers
      progress.ts             Count-based progress bar with timer-driven spinner
      makelog.ts              Render functions for the 3-phase make output
      targetlist.ts           Target listing renderer
      livelist.ts             Live-updating list renderer
      identities.ts           Identity display renderer
      prompt.ts               Interactive TTY prompt
  host/
    command.ts                CommandRunner interface + bunCommandRunner
    context.ts                Context interface + createContext
    path.ts                   HostPath type; home(), absolute(), symbolic(), resolveHostPath()
  identity/
    scope.ts                  Identity scope enum
    store.ts                  Identity persistence (read/write via git config)
  internal/
    gh/                       GitHub CLI wrappers (api, auth, extension, label, labels)
    git/                      Git wrappers (branches, clone, config, submodule)
  provisioning/
    target.ts                 Target interface, Activation union type, link(), linkTree(), target()
    package.ts                PackageRequirement, mergePackages(), tokens(), PackageToken
    plan.ts                   planMake() — resolves selectors to MakePlan with ActivationGroup[]
    deploy.ts                 deployRole() / inspectRole() — materialize assets to deploy store
    activation.ts             runActivation() — link/copy from deploy store to host paths
    run.ts                    runMake() — 3-phase orchestrator (deploy -> install -> activate)
    registry.ts               allTargets(), resolveTarget(), availableSelectors()
    targets/                  One file per provisioning target (git, gh, shell)
scripts/
  generate-assets.ts          Codegen: reads src/assets/files/, writes registry.generated.ts
tests/                        Mirror of src/ layout; one test file per module boundary
```

## Architecture & Implementation Details

### CLI

`main.ts` owns the `Cli` instance (clipanion). It sets `binaryName`, `binaryVersion`, `binaryLabel` from `package.json`, registers `Builtins.HelpCommand`, `Builtins.VersionCommand`, and each command class, then exposes `runCommandLine()` which `createCli().run([...args])`.

Each command is a class extending clipanion's `Command`. Declare `static override paths`, `static override usage` (omit for hidden internal commands), field options via `Option.String()`, `Option.Boolean()`, `Option.Rest()`, `Option.Proxy()`, and `async execute()`. `CommandLineError` (= `UsageError`) routes to stdout with usage display; `AppError`/`ProvisioningError` route to stderr.

`Option.Rest({ required: 1 })` is used for variadic positional arguments (e.g. `make`'s `tags`). `Option.Proxy()` passes all remaining args through to domain functions that do their own parsing (e.g. `internal git clone` URL + `--` flags passthrough).

### 3-Phase Provisioning

`runMake()` drives three sequential phases:

1. Deploy -- `deployRole()` materializes embedded assets into `~/.config/mev/roles/{role}/`. Skips if already present unless `overwrite` is set; with `overwrite`, prunes the role directory and rewrites it.
2. Install -- `installPackages()` runs `brew bundle check` per token; installs only missing ones via `brew bundle install --no-upgrade`.
3. Activate -- `runActivation()` creates symlinks from the deploy store to resolved host paths, at p-limit concurrency of 8.

### Key Types

- `AssetRef` -- `{ key: string }` where `key` is the embed path under `src/assets/files/` (e.g. `git/global/.gitconfig`). Doubles as the deploy store lookup.
- `HostPath` -- symbolic path (e.g. `~/.config/git/config`) resolved against `context.home` at apply time.
- `Activation` -- discriminated union `{ kind: 'file', verb, source: AssetRef, dest: HostPath }` | `{ kind: 'tree', verb, prefix: string, dest: HostPath }`. Verb space is `'copy' | 'link'`.
- `Target` -- groups name, tags/aliases, role, `PackageRequirement`, and `Activation[]`.
- `MakePlan` -- output of `planMake()`; carries deduplicated `tags`, `roles`, merged `packages`, and `ActivationGroup[]` preserving tag attribution through to output.
- `Context` -- `{ home, overwrite, commands: CommandRunner, assets: AssetSource }`. Tests inject fake implementations.

### Asset Codegen

`scripts/generate-assets.ts` walks `src/assets/files/` and writes `registry.generated.ts` as a static `Record<string, string>` map. Runs automatically via `pretest` and `precheck` npm hooks.

### Deploy Store Layout

Assets land at `~/.config/mev/roles/{key}` (e.g. `~/.config/mev/roles/shell/global/.zshenv`). The constant `deployRoot = '.config/mev/roles'` is the sole authority.

### git XDG Convention

The git target links to `~/.config/git/config` and `~/.config/git/ignore`. Both are read by git automatically without any `core.excludesfile` configuration.

### TTY Rendering

`makeStyle(isTTY)` gates all ANSI codes. Color conventions:

- Progress bar filled / spinner: cyan
- Progress bar unfilled: dim
- Deploy lines: dim
- Tag headers: bold
- `link`/`copy` verb and arrow: dim
- Success message: green
- Failed entries: red
- Blocked entries: yellow
- Unchanged counts: dim

## Development Commands

```sh
bun run fix      # Biome autofix -- run before check
bun run check    # codegen + biome lint + tsc --noEmit
bun test         # Run all tests
bun run build    # Compile to dist/mev binary
```

## Development Guidelines

- `bun run fix` is always run before `bun run check`; never skip fix.
- `registry.generated.ts` is generated; edit `src/assets/files/` to change embedded assets.
- Adding a target: create `src/provisioning/targets/{name}.ts` and register it in `src/provisioning/registry.ts`. The registry test validates asset existence and selector uniqueness automatically.
- Tests use sandboxed `HOME` directories under `.tmp/`. `Context` is injected with fake `commands` and `assets` to avoid touching the real filesystem or Homebrew.
- Tests assert observable behavior at the module boundary. Internal file placement, wording, and composition choices are not part of the test contract.
- Temporary files go under `./.tmp/`, never `/tmp/`.

## Documentation Rules

Documentation is written in a declarative style describing the current state of the system. Imperative or changelog-style descriptions are not used (e.g., do not write "Removed X and added Y" or reference version-specific changes).
