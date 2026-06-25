# mev-ts

## Project Overview

`mev` is a macOS development environment provisioning CLI built with Bun and TypeScript. It deploys role-based configuration assets (dotfiles, tool configs) to a deploy store, installs required Homebrew packages, and activates them by creating symlinks or running idempotent host-command pipelines. The CLI is distributed as a single compiled binary.

## Directory Structure

```
src/
  main.ts                     Entry point — CLI setup, command registration, runCommandLine()
  errors.ts                   CommandLineError (= clipanion UsageError), AppError, ProvisioningError
  app/
    identity.ts               User identity resolution (git config + gh auth)
  assets/
    config/                   Embedded config assets, keyed as role/scope/filename
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
    command.ts                CommandRunner interface + bunCommandRunner; CommandOptions (env, cwd)
    context.ts                Context interface + createContext
    path.ts                   HostPath type; home(), absolute(), symbolic(), resolveHostPath()
  identity/
    scope.ts                  Identity scope enum
    store.ts                  Identity persistence (read/write via git config)
  internal/
    gh/                       GitHub CLI wrappers (api, auth, extension, label, labels)
    git/                      Git wrappers (branches, clone, config, submodule)
  provisioning/
    target.ts                 Target interface + target() builder
    package.ts                PackageRequirement, mergePackages(), tokens(), PackageToken
    plan.ts                   planMake() — resolves selectors to MakePlan with ActivationGroup[]
    deploy.ts                 deployRole() / inspectRole() — materialize assets to deploy store
    activation/               Activation DSL and execution engines (see below)
      contract.ts             Activation union type, report types, CommandScope, Verb — pure types
      dispatch.ts             runActivation(), describeActivation(), blockedReport()
      symlink.ts              'file' + 'tree': link(), linkTree(), runFile, runTree
      defaults.ts             'defaults': applyDefaults(), runDefaults
      duti.ts                 'duti': applyDuti(), runDuti — file association engine
      command.ts              'command': runCommand(), step execution engine
      index.ts                Public barrel — all factories and runActivation
    run.ts                    runMake() — 3-phase orchestrator (deploy → install → activate)
    registry.ts               allTargets(), resolveTarget(), availableSelectors()
    targets/                  One file per provisioning target
      git.ts                  Git configuration and global gitignore
      shell.ts                Shell dotfiles and alias tree
      gh.ts                   GitHub CLI configuration
      system.ts               macOS system defaults (Dock, Finder, keyboard, etc.)
      ruby.ts                 Ruby toolchain via rbenv with bundler
      nodejs.ts               Node.js via fnm
      pnpm.ts                 pnpm global packages
      bun.ts                  Bun JavaScript runtime
      nvim.ts                 Neovim configuration
      duti.ts                 macOS file association defaults via duti
scripts/
  generate-assets.ts          Codegen: reads src/assets/config/, writes registry.generated.ts
tests/                        Mirror of src/ layout; one test file per module boundary
```

## Architecture & Implementation Details

### CLI

`main.ts` owns the `Cli` instance (clipanion). It sets `binaryName`, `binaryVersion`, `binaryLabel` from `package.json`, registers `Builtins.HelpCommand`, `Builtins.VersionCommand`, and each command class, then exposes `runCommandLine()` which calls `createCli().run([...args])`.

Each command is a class extending clipanion's `Command`. Declare `static override paths`, `static override usage` (omit for hidden internal commands), field options via `Option.String()`, `Option.Boolean()`, `Option.Rest()`, `Option.Proxy()`, and `async execute()`. `CommandLineError` (= `UsageError`) routes to stdout with usage display; `AppError`/`ProvisioningError` route to stderr.

### 3-Phase Provisioning

`runMake()` drives three sequential phases:

1. Deploy — `deployRole()` materializes embedded assets into `~/.config/mev/roles/{role}/`. Skips if already present unless `overwrite` is set; with `overwrite`, prunes the role directory and rewrites it.
2. Install — `installPackages()` runs `brew bundle check` per token; installs only missing ones via `brew bundle install --no-upgrade`.
3. Activate — `runActivation()` applies each activation kind (symlink, defaults write, host command pipeline) at p-limit concurrency of 8.

### Activation DSL

The `activation/` module is the internal DSL for expressing provisioning work. Target files import factories from `activation/index.ts`; the runtime dispatches to the kind-specific engine.

Five activation kinds:

- `file` — links one deployed asset to a host path via `link(source, dest)`.
- `tree` — mirrors every asset under a prefix into a destination directory via `linkTree(prefix, dest)`. Prunes managed stale links; leaves unmanaged user files.
- `defaults` — applies a YAML list of macOS `defaults write` entries via `applyDefaults(configKey)`. Reads and executes per-entry; continues on individual failure and surfaces failures in the step report.
- `duti` — applies macOS file associations from a YAML config via `applyDuti(configKey)`. For each `{bundle_id, extension}` pair: checks the current handler with `duti -x`; applies `duti -s` only when the handler differs or is unset. Reports per-extension status.
- `command` — runs an ordered, idempotent host-command pipeline via `runCommand({ label, reads?, steps })`. Steps share a `CommandScope` that carries `home`, `basePath`, and values from `reads` assets and prior `capture` outputs (accessed via `s.ref('name')`). Each step can declare `skipIf` (path exists or command succeeds guard), `env` (environment override), `capture` (register stdout for later steps), and `changedWhen` (`'always' | 'never' | { stdoutContains } | { outputNotContains }`; `outputNotContains` matches stdout+stderr combined). `commandSucceeds` guards run with the step's `env` so toolchain shims are on PATH.

### Provisioning Targets

Each target is a file in `src/provisioning/targets/` registered in `src/provisioning/registry.ts`. The registry test validates asset existence and selector uniqueness automatically for every registered target.

### Key Types

- `Activation` — discriminated union with four variants: `file` (AssetRef → HostPath), `tree` (prefix → HostPath), `defaults` (configKey), `command` (label, reads, steps). `Verb` space is `'copy' | 'link' | 'apply' | 'run'`.
- `CommandScope` — `{ home, basePath, ref(name): string }`. `ref` throws `ProvisioningError` on an unknown name, preventing silent `undefined` arguments.
- `StepReport` — `{ key, value, status: 'changed'|'unchanged'|'failed', error? }`. Shared by `defaults` and `command` entries for uniform TTY rendering.
- `AssetRef` — `{ key: string }` where `key` is the embed path under `src/assets/config/` (e.g. `git/global/.gitconfig`). Doubles as the deploy store lookup.
- `HostPath` — symbolic path (e.g. `~/.config/git/config`) resolved against `context.home` at apply time.
- `Target` — groups name, tags/aliases, role, `PackageRequirement`, and `Activation[]`.
- `MakePlan` — output of `planMake()`; carries deduplicated `tags`, `roles`, merged `packages`, and `ActivationGroup[]` preserving tag attribution through to output.
- `Context` — `{ home, overwrite, commands: CommandRunner, assets: AssetSource }`. Tests inject fake implementations.

### Asset Codegen

`scripts/generate-assets.ts` walks `src/assets/config/` and writes `registry.generated.ts` as a static `Record<string, string>` map. Runs automatically via `premev`, `prebuild`, `pretest`, and `precheck` hooks.

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
- verb and arrow: dim
- Success message: green
- Failed entries: red
- Blocked entries: yellow
- Unchanged counts: dim

## Test Infrastructure

Tests use sandboxed directories under `.tmp/`. `Context` is injected with fake `commands` and `assets` to avoid touching the real filesystem or Homebrew.
