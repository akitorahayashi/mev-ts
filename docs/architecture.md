# Architecture

## Overview

`mev` is Local IaC for macOS, compiled to a standalone binary via `bun build --compile`. The repository config is the source of truth for personal machine setup, and the binary embeds configuration assets (dotfiles, YAML configs) so no install-time file extraction is needed.

The execution model is three sequential phases: deploy role assets to the deploy store → install required Homebrew packages → activate each asset (symlink, defaults write, or host-command pipeline).

## Layer Map

```
src/
  cli/          argv parsing, exit code mapping, terminal rendering (clipanion)
  app/          use-case orchestration (identity, config selection)
  provisioning/ target DSL, activation engines, 3-phase orchestrator
  brew/         Homebrew install
  host/         CommandRunner, Context, HostPath
  identity/     Git identity scopes and on-disk store
  assets/       embedded config files and asset registry
  internal/     document conversion plus gh and git tool-boundary commands
  errors.ts     typed error hierarchy
```

## 3-Phase Provisioning (provisioning/run.ts)

`runMake()` drives three sequential phases per make request:

1. Deploy — `deployRole()` stages every embedded asset for the selected roles under a sibling directory. If the staged contents and executable attributes match the present role, the role remains in place; otherwise the old role is moved aside and the staged role replaces it. The final rename sequence provides best-effort rollback for in-process failures; it is not crash-safe.
2. Install — `installPackages()` collects formulae, taps, and casks from all selected targets, deduped across targets. `loadInventory()` (brew/inventory.ts) enumerates installed state once per declared kind (`brew tap`, `brew list --formula -1`, `brew list --cask -1`), so presence checks are in-memory set lookups and only missing tokens run `brew bundle install --no-upgrade`. An enumeration failure fails every token of that kind. Its hooks expose the token entering the install step so the CLI can render a live progress label.
3. Activate — `runActivation()` applies activations in declaration order within each target group. A target group is blocked when its role deploy failed or when one of its declared Homebrew requirements failed to install. Multi-item activation kinds may parallelize their own independent items internally when the kind declares that safe.

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
  zed.ts        'zedSettings' factory and runner
  command.ts    'command' factory and step execution engine
  release.ts    'release' factory and runner
  index.ts      public barrel
```

Eleven activation kinds:

| Kind | Factory | What it does |
|---|---|---|
| `file` | `link(source, dest)` | Symlinks one deployed asset to a host path, replacing the declared destination |
| `tree` | `linkTree(prefix, dest)` | Mirrors every asset under a prefix; replaces declared destinations and prunes managed stale links |
| `defaults` | `applyDefaults(configKey)` | Reads a YAML list and runs `defaults write` per entry |
| `duti` | `applyDuti(configKey)` | Reads a YAML list of `{bundle_id, extension}` pairs; applies `duti -s` for each that differs |
| `pipx` | `applyPipx(configKey)` | Reconciles pipx-managed tools against a YAML manifest; installs, injects, and post-installs |
| `editorExtensions` | `installExtensions(command, configKey)` | Reconciles an editor's installed extensions against a JSON manifest |
| `coderAgents` | `coderAgents(sectionsPrefix, dests)` | Fans out embedded agent config sections into Coder workspace directories |
| `coderSkills` | `coderSkills(skillsPrefix, targetDirs)` | Fans out embedded skill files into Coder workspace directories |
| `zedSettings` | `zedSettings(base, overridesPrefix, dest)` | Deep-merges the base settings asset with the enabled named override fragments and symlinks the result into place |
| `command` | `runCommand({ label, reads?, steps })` | Runs an ordered, idempotent host-command pipeline |
| `release` | `releaseBinaries(binaries)` | Fetches versioned GitHub release binaries; skips if installed version matches |

### Reconcile Envelope

`reconcile.ts` provides the shared execution envelope used by the multi-item activation kinds that call into it (`defaults`, `duti`, `pipx`, `editorExtensions`, `release`). It enforces a structural error boundary at the per-item level rather than leaving it to each implementation:

- `declare()` — yields the set of items to process. A failure here aborts the whole activation.
- `steps(declared)` — builds one `ReconcileStep` per item. This phase runs shared probes (e.g. listing installed tools or extensions) before returning the per-item work. A failure here also aborts the whole activation.
- Per-item isolation — `executeStep` wraps each step's `run()` in a try/catch; a throwing step calls its `onError()` handler and yields a per-item `failed` report without interrupting siblings.
- Status aggregation — `failed` outranks `changed`; an empty declaration reports `unchanged`.

`manifest.ts` provides `readDeployedManifest()`, used by YAML-driven kinds. It translates only `ENOENT` into a labeled "deploy first" message, preserving the original error for all other codes so `EISDIR` or `EACCES` surfaces its real cause. Every parser narrows parsed-`unknown` data through `host/parse.ts` (`isRecord`, `requireRecord`, `requireStringArray`), so the record predicate lives once and rejection messages share one shape instead of each module re-improvising validation.

### Selection Manifests

`coderAgents`, `coderSkills`, and `zedSettings` are filtered by a per-surface selection manifest under `~/.mev/`. `provisioning/selection.ts` owns the manifest IO (`readNameList`/`writeNameList`) and `resolveSelection(catalog, listed, mode)`: `opt-out` (coder) treats the stored list as disabled, so catalog entries added by later updates stay enabled; `opt-in` (zed) treats it as enabled, so a newly added override never applies itself. `app/config-selection.ts` drives the shared `mev config` toggle flow over that resolver. A present manifest that is not a mapping, or that lacks its key, is rejected rather than read as an empty selection.

### Command Pipeline

`runCommand` is the activation kind for operations that require running host commands. Its key concepts:

- `reads` — asset keys whose content is loaded into the scope before any step runs (e.g. `.ruby-version`).
- `CommandScope` — `{ home, basePath, ref(name) }`. `ref` looks up a value by name (from `reads` or a prior `capture`) and throws `ProvisioningError` on a missing name so undefined arguments fail loudly.
- `steps` — ordered. Each step can declare:
  - `argv(scope)` — command to run
  - `env(scope)` — environment override layered over the inherited environment
  - `skipIf(scope)` — idempotency guard: `{ pathExists }` or `{ commandSucceeds }`. `commandSucceeds` guards run with the step's `env` so toolchain shims are on PATH.
  - `capture` — register `stdout.trim()` into scope for later steps
  - `changedWhen` — `'always' | 'never' | { outputContains } | { outputNotContains }` — classify a successful run. `outputContains` and `outputNotContains` both match against combined stdout+stderr.

A failed step halts the pipeline. Skipped steps report `unchanged`. The overall status is `failed` if any step failed, `changed` if any step changed, otherwise `unchanged`.

## Provisioning Targets (provisioning/targets/)

Each target is a self-contained file registered in `provisioning/registry.ts`. A target owns:
- `name` and display description
- `tags` and `aliases` for selector resolution
- `role` — the asset namespace under `src/assets/config/`
- `packages` — Homebrew formulae, taps, and casks required before activation
- `activations` — ordered list of `Activation` values
- `optional` — when set, the target is selectable by tag but excluded from a full-environment `create`

`make` resolves explicit selectors; `create <profile>` resolves a hardware profile (`macbook`/`mbk`, `mac-mini`/`mmn`) and provisions `fullSetupTargets()` — every registered target except the optional ones, in declaration order — through the same three phases. `sync <profile>` scans that same selection and submits only changed targets to one `runMake()` call. The set derives from the registry, so a new target joins both full-environment commands without a separate list. The profile gates the commands to a hardware machine; it does not change the selection.

### Semantic synchronization

`signature.ts` hashes the user-visible desired state of a target: canonical name and role, normalized package requirements, embedded role asset keys/content/executable status, and activation intent in declaration order. Non-command activations contribute their declarative fields. Command activations contribute only their label and asset reads, so changes to `argv`, environment construction, guards, change classification, or runner implementation do not make an otherwise equivalent setup stale.

The signature proving that each target is currently applied is stored atomically at `~/.mev/applied/{target}`. `runMake()` invalidates selected target signatures before deployment and records each signature again only after that target's deploy, package resolution, and activation complete successfully. A failed or interrupted run therefore remains selected even when deployment repaired its role drift before a later phase failed. This state is shared by `make`, `create`, and `sync` rather than owned by the sync command.

`scan.ts` compares current and applied signatures and separately compares each embedded role tree with `~/.mev/roles/{role}/`, including paths, contents, and executable attributes. A signature mismatch or deployed drift selects the target. Scans run concurrently, while selected targets run through one normal provisioning plan so Homebrew and activation writes retain their established ordering. Optional targets are outside the scanned selection.

The registry test (`src/provisioning/registry.test.ts`) validates asset existence and selector uniqueness automatically for all registered targets. Adding a target does not require new test files.

## Asset Embedding (assets/)

Raw config files live under `src/assets/config/` keyed as `{role}/global/{filename}`. `scripts/generate-assets.ts` walks the tree and inlines every file's content as a string, emitting `assets/registry.generated.ts`. The content is embedded in the compiled binary; no per-file imports or filesystem access occur at runtime.

`assets/registry.ts` wraps the generated map as `AssetSource`. An unknown key throws `ProvisioningError`. `keysByPrefix` lets targets derive their file lists from the embedded set rather than enumerating them by hand.

`AssetRef` keys double as sub-paths under the deploy root (`~/.mev/roles/`), so the deployed filename preserves the original dotfile name without a separate mapping.

## Context (host/)

`Context` — `{ home, commands: CommandRunner, assets: AssetSource, basePath }` — is assembled by `createContext()` and injected through every provisioning call. `basePath` is the inherited `PATH`, read once in `createContext`, so command steps and pipx resolve tools through the injected value rather than reading `process.env` themselves. `resolveHome()` performs the only other `process.env` read (HOME), and `bunCommandRunner` layers an explicit `env` over the ambient `Bun.env` at spawn. Tests supply a hand-built `Context` rather than calling `createContext`, eliminating the need to mock modules or spawn real processes.

`CommandRunner.run(command, args, options?)` accepts `CommandOptions { env?, cwd?, stdout?, stderr? }`. `env` is layered over the inherited environment via `{ ...Bun.env, ...options.env }`; `stdout` and `stderr` each select `'pipe'` (the default, captured into the result) or `'inherit'`. A spawn failure — a missing or otherwise unspawnable executable — resolves as `code 127` with the reason in `stderr` rather than rejecting, so every call site handles it as an ordinary non-zero exit.

## Document Conversion (internal/document/)

The hidden `mev internal document markdown-to-pdf` and `pdf-to-markdown` commands back the `md2pdf` and `pdf2md` shell aliases. The shell target owns both the aliases and their Pandoc, Poppler, and Google Chrome runtime dependencies.

Markdown-to-PDF first asks Pandoc for standalone HTML with Pygments syntax highlighting, MathML, embedded local resources, and the bundled print stylesheet. A Playwright-managed Chrome context blocks HTTP requests, renders fenced `mermaid` blocks from the Mermaid script embedded in the binary, and writes each PDF atomically. PDF-to-Markdown uses `pdftotext` for UTF-8 extraction and does not infer semantic Markdown structure. File and recursive-directory inputs share one planner that preserves relative paths, excludes a nested output directory, and rejects output collisions before conversion starts.

`mermaid` and `playwright-core` are exact-pinned (no caret) in `package.json`. The Mermaid script is imported by its deep `mermaid/dist/mermaid.min.js` path, bypassing the package's public API, so a minor release can relocate or reshape that file; `playwright-core` is pinned in lockstep with the `--external chromium-bidi/*` bundling workaround in `scripts/build.ts`. Changing either pin is a deliberate, tested decision rather than a lockfile refresh.

## Capability Modules

Several activation kinds delegate external-tool protocol and state detection to capability modules rather than implementing them inline. Capability modules own the external tool's protocol, output format, and platform-specific state probes. They accept a `Context` and import no activation types (`Activation`, `ActivationReport`, `StepReport`). Activation modules may import from capabilities; capabilities never import from `provisioning/activation/`.

| Directory | Capability |
|---|---|
| `pipx/` | `pipx list --json` parse; install, inject, and post-install operations |
| `duti/` | `duti -x` output parse; `duti -s` apply |
| `editor/` | `--list-extensions` parse; `--install-extension` |
| `github/` | GitHub release download via `curl` (public) or `gh release download` (private) |

## Identity (identity/)

The identity domain owns Git identity switching independently of the provisioning engine. `identity/scope.ts` is the authority for switchable scopes and their aliases. `identity/store.ts` persists a profile pair to `~/.mev/identity.json` via atomic temp-write + rename. `app/identity.ts` orchestrates the show/set/switch use cases.

## Deploy Store Layout

All deployed assets land at `~/.mev/roles/{key}`. The constant `deployRoot = '${mevRoot}/roles'` (built from `mevRoot = '.mev'` in `host/path.ts`, the sole authority for the mev-managed root) in `assets/ref.ts` is the sole authority for this path. Symlinks created by `file` and `tree` activations point into this store, and declared symlink destinations are reconciled from the current repository config.
