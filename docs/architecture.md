# Architecture

## Overview

`mev` is Local IaC for macOS, compiled to a standalone binary via `bun build --compile`. The repository config is the source of truth for personal machine setup, and the binary embeds configuration assets (dotfiles, YAML configs) so no install-time file extraction is needed.

The execution model protects target-declared mutable host state, then runs three sequential phases: deploy role assets to the deploy store → install required Homebrew packages → activate each asset (symlink, defaults write, or host-command pipeline).

## Layer Map

```
src/
  cli/          argv parsing, exit code mapping, terminal rendering (clipanion)
  app/          use-case orchestration (identity, config selection)
  provisioning/ target DSL, activation engines, 3-phase orchestrator
  agent-plugin/ Claude Code/Codex marketplace inventory and install protocols
  brew/         Homebrew install
  coder/        Coder catalogs, manifests, and renderers
  config-selection/ shared selection manifest parser/resolver
  defaults/     macOS defaults manifest and protocol helpers
  host/         CommandRunner, Context, HostPath, plus shared primitives for subprocess (command-run), download, managed-link, deploy-read, parsing (parse), YAML (yaml), bounded concurrency (task-pool), and cleanup-error composition
  identity/     Git identity scopes and on-disk store
  assets/       embedded config files and asset registry
  git/          Git config and command helpers
  internal/     document conversion plus gh and hidden git commands
  zed/          Zed override catalog, manifest, and settings renderer
  errors.ts     typed error hierarchy
```

## CLI (cli/)

`main.ts` owns the clipanion `Cli` and registers the commands enumerated in `cli/commands/registry.ts`, the single registration source; namespace-help routing derives from their paths. Each command subclasses `Command`. `CommandLineError` (= `UsageError`) goes to stdout with usage. Commands that can transitively throw `AppError`/`ProvisioningError` wrap their execute body with `runReportingDomainErrors`, which prints `<name>: <message>` to stderr without stack or usage and returns exit code 1; pure renderers stay unwrapped. `src/errors.ts` documents the `AppError`/`ProvisioningError`/`CommandLineError` taxonomy.

## 3-Phase Provisioning (provisioning/run.ts)

`runMake()` drives three sequential phases per make request:

Before invalidating applied signatures or entering the phases, each selected target's `preserveBeforeDeploy` operation protects mutable host state that its role replacement could otherwise destroy. A preservation failure aborts before provisioning-managed state changes. The Git target uses this boundary to move legacy identity keys out of its managed XDG config.

1. Deploy — `deployRole()` stages every embedded asset for the selected roles under a sibling directory. If the staged contents and executable attributes match the present role, the role remains in place; otherwise the old role is moved aside and the staged role replaces it. The final rename sequence provides best-effort rollback for in-process failures; it is not crash-safe.
2. Install — `installPackages()` collects formulae, taps, and casks from all selected targets, deduped across targets. `loadInventory()` (brew/inventory.ts) enumerates installed state once per declared kind (`brew tap`, `brew list --formula -1`, `brew list --cask -1`), so presence checks are in-memory set lookups and only missing tokens run `brew bundle install --no-upgrade`. An enumeration failure fails every token of that kind. Its hooks expose the token entering the install step so the CLI can render a live progress label.
3. Activate — `runActivation()` applies activations in declaration order within each target group. A target group is blocked when its role deploy failed or when one of its declared Homebrew requirements failed to install. Multi-item activation kinds may parallelize their own independent items internally when the kind declares that safe.

Each activation also receives the run's `ActivationRunOptions`. Its `update` flag (the `--update`/`-u` CLI option on `make`, `create`, and `sync`) is execution intent, not desired state: it makes the `pipx`, `pnpm`, `release`, and `agentPlugins` kinds refresh installed latest-assumed items, never contributes to target signatures or sync staleness, and leaves version-pinned entries untouched.

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
  pnpm.ts       'pnpm' factory and runner
  extensions.ts 'editorExtensions' factory and runner
  agent-plugins.ts 'agentPlugins' marketplace and plugin reconciler
  coder.ts      'coderAgents' + 'coderSkills' factories and runners
  codex-config.ts 'codexConfig' factory and runner
  zed.ts        'zedSettings' factory and runner
  command.ts    'command' factory and step execution engine
  release.ts    'release' factory and runner
  remote-installer.ts reviewed remote-script download and execution
  index.ts      public barrel
```

Fifteen activation kinds:

| Kind | Factory | What it does |
|---|---|---|
| `file` | `link(source, dest)` | Symlinks one deployed asset to a host path, replacing the declared destination |
| `tree` | `linkTree(prefix, dest)` | Mirrors every asset under a prefix; replaces declared destinations and prunes managed stale links |
| `defaults` | `applyDefaults(configKey)` | Reads a YAML list and runs `defaults write` per entry |
| `duti` | `applyDuti(configKey)` | Reads a YAML list of `{bundle_id, extension}` pairs; applies `duti -s` for each that differs |
| `pipx` | `applyPipx(configKey)` | Reconciles pipx-managed tools against a YAML manifest; installs, injects, and post-installs; uninstalls only the names the manifest's `uninstall` list declares; update mode upgrades installed `latest`-declared tools |
| `pnpm` | `applyPnpm(configKey)` | Reconciles pnpm global packages against a YAML manifest through `fnm exec`; installs missing and pin-mismatched packages; uninstalls only the names the manifest's `uninstall` list declares; update mode re-resolves latest-assumed packages |
| `editorExtensions` | `installExtensions(command, configKey)` | Reconciles an editor's installed extensions against a JSON manifest |
| `coderAgents` | `coderAgents(sectionsPrefix, dests)` | Fans out embedded agent config sections into Coder workspace directories |
| `coderSkills` | `coderSkills(skillsPrefix, targetDirs)` | Fans out embedded skill files into Coder workspace directories |
| `agentPlugins` | `installAgentPlugins(configKey)` | Installs missing Claude Code and Codex plugins from SSH-backed `main` marketplaces; installed plugins are updated only in update mode; uninstalls only the plugins and marketplaces the catalog explicitly lists for removal |
| `zedSettings` | `zedSettings(base, overridesPrefix, dest)` | Deep-merges the base settings asset with the enabled named override fragments and symlinks the result into place |
| `codexConfig` | `codexConfig(source, dest)` | Enforces the declared TOML values into the codex-owned config file, preserving runtime tables; equality is structural, so codex's own rewrites never re-trigger it |
| `command` | `runCommand({ label, reads?, steps })` | Runs an ordered, idempotent host-command pipeline |
| `release` | `releaseBinaries(binaries)` | Fetches GitHub release binaries at a pinned tag or the repository's latest release; skips when the installed binary already reports that tag's version, and re-resolves `latest` only in update mode |
| `remoteInstaller` | `remoteInstaller({ label, url, interpreter, args, creates, integrity })` | Downloads a reviewed HTTPS installer script or binary to a temporary file, satisfies its required `integrity` discriminant, runs it with declared arguments, and cleans the temporary file |

### Reconcile Envelope

`reconcile.ts` provides the shared execution envelope used by the multi-item activation kinds that call into it (`defaults`, `duti`, `pipx`, `pnpm`, `editorExtensions`, `release`). It enforces a structural error boundary at the per-item level rather than leaving it to each implementation:

- `declare()` — yields the set of items to process. A failure here aborts the whole activation.
- `steps(declared)` — builds one `ReconcileStep` per item. This phase runs shared probes (e.g. listing installed tools or extensions) before returning the per-item work. A failure here also aborts the whole activation.
- Per-item isolation — `executeStep` wraps each step's `run()` in a try/catch; a throwing step calls its `onError()` handler and yields a per-item `failed` report without interrupting siblings.
- Status aggregation — `failed` outranks `changed`; an empty declaration reports `unchanged`.
- Concurrency — kinds default to serial execution; only `release` opts into a bounded parallel loop because its items are independent network downloads.

`coderAgents` and `coderSkills` do not use this envelope but apply the same per-item boundary to their symlink fan-out: a read or build failure fails the whole activation, while an unwritable destination directory fails only its own entry and its siblings still apply.

`agentPlugins` inventories Claude Code and Codex once per client. Outside update mode, a marketplace with no missing declared plugins performs no marketplace operation. For a missing plugin, the activation adds the SSH marketplace at `main`, or refreshes an existing marketplace only when its registered remote names the declared repository and its ref is `main`, then installs only the missing IDs. Ownership is decided by the remote's `owner/name`, not the whole URL: the SSH host alias is per-machine transport that `mev config ssh-host` changes freely and that the target signature does not cover, so a marketplace registered under a previous alias is still the declared one. A remote in any form mev does not register — https, or a different repository — is foreign. Installed disabled plugins still count as present. Marketplace source conflicts fail without removing or replacing user state, and a final client inventory verifies successful install commands. Antigravity plugins are outside this activation.

Removal is declarative and strictly explicit: a catalog marketplace may carry an `uninstall` list, and the catalog root a `removed_marketplaces` list. Both are optional and absent by default, since an omitted list means nothing to remove. A name in `uninstall` is uninstalled as `<name>@<marketplace>`; a `removed_marketplaces` entry first verifies that the registered marketplace's remote names the tombstone's repository — a same-named marketplace registered from any other repository (including Codex built-ins, which report no source) refuses removal and leaves its whole namespace untouched — then uninstalls every installed plugin in that marketplace's id namespace, re-inventories the client to confirm they are gone, and only then deregisters the marketplace. The plugin-before-marketplace order is fixed because neither client documents whether marketplace removal cascades, and the inline confirmation exists because a zero exit status is not proof of removal — deregistering while a plugin survived would orphan it, so an unconfirmed removal blocks instead. An active marketplace list may be empty, which is what removing the last declared marketplace leaves behind. Nothing is ever derived from inventory diffs against the declared plugins, so per-machine manual installs are never touched. Uninstalls are local-only — they run before and independently of the network-bound marketplace phase and ignore the update flag — and the final client inventory verifies each removed id is absent. mev owns only the Claude user scope: removals pin `--scope user` and the Claude inventory reads only user-scope entries, so a same-id plugin in another scope neither satisfies an install nor fails an uninstall verification.

In update mode every declared marketplace is refreshed from `main` first, then each installed declared plugin is updated: Claude Code through `plugin update`, Codex by re-adding the plugin, which re-resolves its version from the refreshed snapshot because the Codex CLI has no plugin-level update verb. The refresh of an existing marketplace is a probe and produces no report entry — only marketplace additions and failures do — so a run that moved nothing reports unchanged; change surfaces through the per-plugin version diffs. The final client inventory classifies each update as changed or unchanged by that diff; when a client reports no version, the update stays classified as changed because a no-op cannot be proven. An unreachable marketplace fails its installed plugins as `update blocked` instead of reporting them unchanged.

`codexConfig` inverts ownership relative to the linked configs: `~/.codex/config.toml` is a mutable file codex rewrites wholesale at runtime (plugin and marketplace registrations, app-managed MCP servers), so mev enforces only the keys the embedded asset declares. On machines provisioned before this kind existed the path is still a symlink into the deploy store, so the coder target's `preserveBeforeDeploy` materializes it into a regular file ahead of the deploy phase; without that, the deploy would reset the role file — and with it codex's registrations — before the activation ever read them. Declared tables merge per key with declared values winning, declared scalars and arrays replace, and host-only tables pass through untouched. The unchanged check compares parsed values rather than bytes, so codex reserializing the file never re-triggers a write, and the destination is materialized as a regular file — a symlink into the deploy store would route codex's writes into the deployed role (permanent drift) while every deploy would wipe codex's registrations.

The `pipx`, `pnpm`, and `release` manifests share one declaration vocabulary: every entry states its desired version as either the reserved literal `latest` or an exact pin, never by omission. `latest` is re-resolved only in update mode, a pin never is, and a pin is compared literally against the version the tool reports — so each parser admits only the spelling its ecosystem reports back (PEP 440's normalized public version for pipx, semver for pnpm, the tag's version for release) and rejects ranges, which could never compare equal and would reinstall on every run. A pipx pin is additionally quoted, since PEP 440 admits versions YAML types as numbers (`1.0`, `20250625`) and rendering one back as text resolves to a different pin.

These manifests declare an identity and a version, not a source. An item installed under a declared name from some other source is adopted as-is and keeps following it — pipx reuses the `package_or_url` its venv records — so removing the item is what forces a fresh resolution.

The `pipx` and `pnpm` manifests share the same removal vocabulary: an optional root `uninstall` list, absent by default, whose names alone are ever removed. A listed name still present in the tool's inventory is uninstalled; an already absent name reports unchanged, so repeat runs stay idempotent. Removals run before installs, and nothing is ever derived from inventory diffs against the declared items, so mev never targets a package it was not told to remove. pnpm itself removes at installation-group granularity, so whenever a listed removal actually runs, the pnpm installs reconcile against a re-read inventory rather than the pre-removal snapshot — a declared package that a group removal swept away is reinstalled in the same run.

`manifest.ts` provides `readDeployedManifest()`, used by YAML-driven kinds. It translates only `ENOENT` into a labeled "deploy first" message, preserving the original error for all other codes so `EISDIR` or `EACCES` surfaces its real cause. Every parser narrows parsed-`unknown` data through `host/parse.ts` (`isRecord`, `requireRecord`, `requireStringArray`), so the record predicate lives once and rejection messages share one shape instead of each module re-improvising validation.

### Selection Manifests

`coderAgents`, `coderSkills`, and `zedSettings` are filtered by a per-surface selection manifest under `~/.mev/`. See docs/config.md for the catalog sources, the manifest IO contract, opt-in/opt-out polarity, and the Zed settings-merge algorithm.

### Command Pipeline

`runCommand` is the activation kind for operations that require running host commands. Its key concepts:

- `reads` — asset keys whose content is bound into the scope before any step runs (e.g. `.ruby-version`); a `derive` read binds a transform of the raw content, otherwise the trimmed value is bound after an optional `validate`.
- Scope — the named values a step resolves against at apply time: the reserved host facts `home` and `basePath` (the inherited `PATH`), the assets declared in `reads`, and the stdout of any prior `capture`. `ref(name)` throws `ProvisioningError` on a missing name so undefined arguments fail loudly.
- `steps` — ordered declarative data, resolved against the scope at apply time. Each step can declare:
  - `argv` — argument tokens, each a literal string, a `ref` (one scope value), a `splitRef` (a scope value split on whitespace), or a `concat` of tokens
  - `env` — environment overrides layered over the inherited environment; each value is a literal, a `ref`, a `concat`, or a `pathList` joined with `:`
  - `skipIf` — idempotency guard built from the same tokens: `{ pathExists }` or `{ commandSucceeds }`. `commandSucceeds` guards run with the step's `env` so toolchain shims are on PATH.
  - `capture` — register `stdout.trim()` into scope for later steps
  - `changedWhen` — `'always' | 'never' | { outputContains } | { outputNotContains }` — classify a successful run. `outputContains` and `outputNotContains` both match against combined stdout+stderr.

A failed step halts the pipeline. Skipped steps report `unchanged`. The overall status is `failed` if any step failed, `changed` if any step changed, otherwise `unchanged`.

### Release binaries

A `binaries.yml` entry declares `tag` as either an exact release tag or the reserved literal `latest`, the same latest-assumed vocabulary the pnpm manifest uses for `version`. The asset is always downloaded from a concrete tag, so `latest` is resolved first through `https://api.github.com/repos/{repo}/releases/latest` and its `tag_name` is what the download URL names.

Idempotency is the binary's own `--version`, so no digest lock, inventory, or host-side state store exists. Each declared binary reports `<name> <version>` — clap's default rendering — and its release tag is that version with an optional leading `v`. Only the version token is compared, so a binary whose self-reported name differs from its manifest name or repository (`tc` from `tmpc`) still matches. A non-zero exit is the not-installed signal that triggers a fetch, which subsumes a missing, unspawnable, or broken binary; the cheap execute-bit repair is kept so a stripped mode costs a `chmod` rather than a download. A successful run printing anything else is a contract breach and fails, because degrading to a mismatch would silently re-download the same binary forever. A downloaded asset is probed while still staged, before the atomic rename, and must report the version its tag denotes; rejecting it there leaves the previous binary in place. Verifying after the swap would instead overwrite a working binary with a mislabeled one and, for a `latest` entry, let it pass as up to date on the next run, since that path skips re-resolution whenever a binary is present.

A pinned entry never re-resolves; matching the installed version skips it without touching the network. An installed `latest` entry holds still until update mode asks for re-resolution, and even then a resolved tag equal to the installed version downloads nothing. The network is therefore reached only when a binary is absent or `--update` is set. Release assets are not digest-verified at download time — the declared binaries are first-party, the same trust boundary that lets first-party plugin marketplaces track `main`.

`tag` is part of the embedded role asset, so flipping an entry between `latest` and a pin moves the target signature and `sync` reselects the target; update mode does not alter declared intent and so does not. Reconciliation compares only the version the binary reports, so replacing an entry's `repo` while its version stays the same is not detected — the reselected target reconciles to `unchanged` and records the new signature over a binary that still came from the old repository. Change the tag alongside the repository, or remove the binary, to force the reinstall.

### Remote installers

`remoteInstaller` is reserved for upstream installers that are distributed as scripts or installer binaries rather than as Homebrew packages or versioned release binaries. It downloads the HTTPS installer to a temporary file with strict curl transport flags, then satisfies a required `integrity` discriminant before running: `{ checksumUrl }` downloads the checksum document and verifies the file's SHA256 against it, while `{ acknowledgedUnverified: true }` is a loud, reviewed opt-out — there is no silent skip. It then runs a declared interpreter or the downloaded file directly with declared arguments, skips when the declared `creates` path exists, and removes the temporary directory after the run. Targets use it only for reviewed first-party installer URLs.

## Provisioning Targets (provisioning/targets/)

Each target is a self-contained file registered in `provisioning/registry.ts`. A target owns:
- `name` and display description
- `aliases` for alternate selector resolution
- `role` — the asset namespace under `src/assets/config/`
- `packages` — Homebrew formulae, taps, and casks required before activation
- `preserveBeforeDeploy` — optional protection for mutable host state that role replacement would destroy
- `activations` — ordered list of `Activation` values
- `optional` — when set, the target is selectable by name or alias but excluded from a full-environment `create`

`make` resolves explicit selectors; `create` provisions `fullSetupTargets()` — every registered target except the optional ones, in declaration order — through the same three phases. `sync` scans that same selection and submits only changed targets to one `runMake()` call. The set derives from the registry, so a new target joins both full-environment commands without a separate list.

### Semantic synchronization

`signature.ts` hashes the user-visible desired state of a target: canonical name and role, normalized package requirements, embedded role asset keys/content/executable status, and activation intent in declaration order. Non-command activations contribute their declarative fields. Command activations are themselves declarative: they contribute their label, asset reads, and per-step data — argv tokens (literal/`ref`/`splitRef`/`concat`), env values (including a `pathList` form), `skipIf` guard tokens, captures, and change-classification declarations. This step data is resolved at apply time against a scope of reads and captures plus the reserved `home` and `basePath`; because the signature hashes the same data, editing a command's argv, env, or guard flips the signature, with no manual version counter.

The signature proving that each target is currently applied is stored atomically at `~/.mev/applied/{target}`. `runMake()` invalidates selected target signatures before deployment and records each signature again only after that target's deploy, package resolution, and activation complete successfully. A failed or interrupted run therefore remains selected even when deployment repaired its role drift before a later phase failed. This state is shared by `make`, `create`, and `sync` rather than owned by the sync command.

`scan.ts` compares current and applied signatures and separately compares each embedded role tree with `~/.mev/roles/{role}/`, including paths, contents, and executable attributes. A signature mismatch or deployed drift selects the target. Scans run concurrently, while selected targets run through one normal provisioning plan so Homebrew and activation writes retain their established ordering. Optional targets are outside the scanned selection.

Update mode never widens this selection: `sync --update` applies update mode only within the targets the scan already selected, so a synchronized environment exits without provisioning or network access. A deliberate full refresh of latest-assumed tools is `create --update` or `make <target> --update`.

The registry test (`src/provisioning/registry.test.ts`) validates asset existence and selector uniqueness automatically for all registered targets. Adding a target does not require new test files.

## Asset Embedding (assets/)

Raw config files live under `src/assets/config/` keyed as `{role}/{filename}`. `scripts/generate-assets.ts` walks the tree and inlines every file's content as a string, emitting `assets/registry.generated.ts`. The content is embedded in the compiled binary; no per-file imports or filesystem access occur at runtime. The generated file also embeds a `registrySourceHash` over the source tree; `scripts/validate-assets.ts` recomputes that hash and fails loudly when the committed registry is stale, so drift surfaces as an explicit error rather than confusing downstream failures.

`assets/registry.ts` wraps the generated map as `AssetSource`. An unknown key throws `ProvisioningError`. `keysByPrefix` lets targets derive their file lists from the embedded set rather than enumerating them by hand.

`AssetRef` keys double as sub-paths under the deploy root (`~/.mev/roles/`), so the deployed filename preserves the original dotfile name without a separate mapping.

## Context (host/)

`Context` — `{ home, commands: CommandRunner, assets: AssetSource, basePath, tmpRoot }` — is assembled by `createContext()` and injected through every provisioning call. `basePath` is the inherited `PATH`, read once in `createContext`, so command steps and pipx resolve tools through the injected value rather than reading `process.env` themselves. `tmpRoot` is the root for short-lived scratch directories (e.g. the remote-installer workspace), defaulting to the system temp directory; tests inject a sandbox path instead. `resolveHome()` performs the only other `process.env` read (HOME), and `bunCommandRunner` layers an explicit `env` over the ambient `Bun.env` at spawn. Tests supply a hand-built `Context` rather than calling `createContext`, eliminating the need to mock modules or spawn real processes.

`CommandRunner.run(command, args, options?)` accepts `CommandOptions { env?, cwd?, stdout?, stderr? }`. `env` is layered over the inherited environment via `{ ...Bun.env, ...options.env }`; `stdout` and `stderr` each select `'pipe'` (the default, captured into the result) or `'inherit'`. A spawn failure — a missing or otherwise unspawnable executable — resolves as `code 127` with the reason in `stderr` rather than rejecting, so every call site handles it as an ordinary non-zero exit.

## Document Conversion (internal/document/)

The hidden `mev internal document markdown-to-pdf` and `pdf-to-markdown` commands back the `md2pdf` and `pdf2md` shell aliases. The shell target owns both the aliases and their Pandoc, Poppler, and Google Chrome runtime dependencies.

Markdown-to-PDF first asks Pandoc for standalone HTML with Pygments syntax highlighting, MathML, embedded local resources, and the bundled print stylesheet. A Playwright-managed Chrome context blocks HTTP requests, renders fenced `mermaid` blocks from the Mermaid script embedded in the binary, and writes each PDF atomically. PDF-to-Markdown uses `pdftotext` for UTF-8 extraction and does not infer semantic Markdown structure. File and recursive-directory inputs share one planner that preserves relative paths, excludes a nested output directory, and rejects output collisions before conversion starts.

`mermaid` and `playwright-core` are exact-pinned (no caret) in `package.json`. The Mermaid script is imported by its deep `mermaid/dist/mermaid.min.js` path, bypassing the package's public API, so a minor release can relocate or reshape that file; `playwright-core` is pinned in lockstep with the `--external chromium-bidi/*` bundling workaround in `scripts/build-bundle.ts`, the shared build pipeline used by both `scripts/build.ts` and `scripts/install-mev.ts`; that pipeline also asserts at build time that `mermaid/dist/mermaid.min.js` resolves. Changing either pin is a deliberate, tested decision rather than a lockfile refresh.

## Capability Modules

Several activation kinds delegate external-tool protocol and state detection to capability modules rather than implementing them inline. Capability modules own the external tool's protocol, output format, and platform-specific state probes. They accept a `Context` and import no activation types (`Activation`, `ActivationReport`, `StepReport`). Activation modules may import from capabilities; capabilities never import from `provisioning/activation/`.

| Directory | Capability |
|---|---|
| `pipx/` | `pipx list --json` parse; install, inject, and post-install operations |
| `pnpm/` | `pnpm ls -g --json` parse; global add/remove through the fnm default node runtime |
| `defaults/` | defaults manifest validation and macOS defaults read/write comparison helpers |
| `duti/` | `duti -x` output parse; `duti -s` apply |
| `editor/` | `--list-extensions` parse; `--install-extension` |
| `coder/` | Coder section/skill catalogs, manifests, and renderers |
| `agent-plugin/` | Claude Code/Codex JSON inventories and SSH marketplace operations |
| `github/` | Public GitHub release download via `curl`; per-machine SSH host alias store |
| `git/` | Git config mutation and locale-pinned git command helpers |
| `zed/` | Zed override catalog, manifest, and settings renderer |

## Identity (identity/)

The identity domain owns Git identity switching independently of the provisioning engine. `identity/scope.ts` is the authority for switchable scopes and their aliases. `identity/store.ts` persists a profile pair to `~/.mev/identity.json` via atomic temp-write + rename. `app/identity.ts` orchestrates the show/set/switch use cases. The managed static Git config is the XDG file at `~/.config/git/config`; `switch` writes the active `user.name` and `user.email` explicitly to the higher-precedence mutable overlay at `~/.gitconfig`. `identity/overlay.ts` preserves legacy identity keys into that overlay before the Git role is replaced, leaving existing overlay values unchanged.

## Deploy Store Layout

All deployed assets land at `~/.mev/roles/{key}`. The constant `deployRoot = '${mevRoot}/roles'` (built from `mevRoot = '.mev'` in `host/path.ts`, the sole authority for the mev-managed root) in `assets/ref.ts` is the sole authority for this path. Symlinks created by `file` and `tree` activations point into this store, and declared symlink destinations are reconciled from the current repository config.
