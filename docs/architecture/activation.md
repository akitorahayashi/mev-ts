# Activation DSL (provisioning/activation/)

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
  materialized-file.ts 'materializedFile' factory and runner
  command.ts    'command' factory and step execution engine
  release.ts    'release' factory and runner
  remote-installer.ts reviewed remote-script download and execution
  index.ts      public barrel
```

## Kinds

Sixteen activation kinds:

| Kind | Factory | What it does |
|---|---|---|
| `file` | `link(source, dest)` | Symlinks one deployed asset to a host path, replacing the declared destination |
| `materializedFile` | `materializeFile(source, dest)` | Places one deployed asset as a regular host file; an identical regular file is unchanged, while other destination states are replaced atomically |
| `tree` | `linkTree(prefix, dest)` | Mirrors every asset under a prefix; replaces declared destinations and prunes managed stale links |
| `defaults` | `applyDefaults(configKey)` | Reads a YAML list and runs `defaults write` per entry |
| `duti` | `applyDuti(configKey)` | Reads a YAML list of `{bundle_id, extension}` pairs; applies `duti -s` for each that differs |
| `pipx` | `applyPipx(configKey)` | Reconciles pipx-managed tools against a YAML manifest; installs, injects, and post-installs; uninstalls only the names the manifest's `uninstall` list declares; upgrade mode upgrades installed `latest`-declared tools |
| `pnpm` | `applyPnpm(configKey)` | Reconciles pnpm global packages against a YAML manifest through `fnm exec`; installs missing and pin-mismatched packages; uninstalls only the names the manifest's `uninstall` list declares; upgrade mode re-resolves latest-assumed packages |
| `editorExtensions` | `installExtensions(command, configKey)` | Reconciles an editor's installed extensions against a JSON manifest |
| `coderAgents` | `coderAgents(sectionsPrefix, dests)` | Fans out embedded agent config sections into Coder workspace directories |
| `coderSkills` | `coderSkills(skillsPrefix, targetDirs)` | Fans out embedded skill files into Coder workspace directories |
| `agentPlugins` | `installAgentPlugins(configKey)` | Installs missing Claude Code and Codex plugins from SSH-backed `main` marketplaces; installed plugins are upgraded only in upgrade mode; uninstalls only the plugins and marketplaces the catalog explicitly lists for removal |
| `zedSettings` | `zedSettings(base, overridesPrefix, dest)` | Deep-merges the base settings asset with the enabled named override fragments and symlinks the result into place |
| `codexConfig` | `codexConfig(source, dest)` | Enforces the declared TOML values into the codex-owned config file, preserving runtime tables; equality is structural, so codex's own rewrites never re-trigger it |
| `command` | `runCommand({ label, reads?, steps })` | Runs an ordered, idempotent host-command pipeline |
| `release` | `releaseBinaries(binaries)` | Fetches GitHub release binaries at a pinned tag or the repository's latest release; skips when the installed binary already reports that tag's version, and re-resolves `latest` only in upgrade mode |
| `remoteInstaller` | `remoteInstaller({ label, url, interpreter, args, creates, integrity })` | Downloads a reviewed HTTPS installer script or binary to a temporary file, satisfies its required `integrity` discriminant, runs it with declared arguments, and cleans the temporary file |

## Reconcile Envelope

`reconcile.ts` provides the shared execution envelope used by the multi-item activation kinds that call into it (`defaults`, `duti`, `pipx`, `pnpm`, `editorExtensions`, `release`). It enforces a structural error boundary at the per-item level rather than leaving it to each implementation:

- `declare()` — yields the set of items to process. A failure here aborts the whole activation.
- `steps(declared)` — builds one `ReconcileStep` per item. This phase runs shared probes (e.g. listing installed tools or extensions) before returning the per-item work. A failure here also aborts the whole activation.
- Per-item isolation — `executeStep` wraps each step's `run()` in a try/catch; a throwing step calls its `onError()` handler and yields a per-item `failed` report without interrupting siblings.
- Status aggregation — `failed` outranks `changed`; an empty declaration reports `unchanged`.
- Concurrency — kinds default to serial execution; only `release` opts into a bounded parallel loop because its items are independent network downloads.

`coderAgents` and `coderSkills` do not use this envelope but apply the same per-item boundary to their symlink fan-out: a read or build failure fails the whole activation, while an unwritable destination directory fails only its own entry and its siblings still apply.

See agent-plugins.md for the `agentPlugins` reconciler's marketplace and plugin lifecycle, and the `codexConfig` kind's ownership inversion relative to the linked configs.

## Shared Manifest Vocabulary

The `pipx`, `pnpm`, and `release` manifests share one declaration vocabulary: every entry states its desired version as either the reserved literal `latest` or an exact pin, never by omission. `latest` is re-resolved only in upgrade mode, a pin never is, and a pin is compared literally against the version the tool reports — so each parser admits only the spelling its ecosystem reports back (PEP 440's normalized public version for pipx, semver for pnpm, the tag's version for release) and rejects ranges, which could never compare equal and would reinstall on every run. A pipx pin is additionally quoted, since PEP 440 admits versions YAML types as numbers (`1.0`, `20250625`) and rendering one back as text resolves to a different pin.

These manifests declare an identity and a version, not a source. An item installed under a declared name from some other source is adopted as-is and keeps following it — pipx reuses the `package_or_url` its venv records — so removing the item is what forces a fresh resolution.

The `pipx` and `pnpm` manifests share the same removal vocabulary: an optional root `uninstall` list, absent by default, whose names alone are ever removed. A listed name still present in the tool's inventory is uninstalled; an already absent name reports unchanged, so repeat runs stay idempotent. Removals run before installs, and nothing is ever derived from inventory diffs against the declared items, so mev never targets a package it was not told to remove. pnpm itself removes at installation-group granularity, so whenever a listed removal actually runs, the pnpm installs reconcile against a re-read inventory rather than the pre-removal snapshot — a declared package that a group removal swept away is reinstalled in the same run.

`manifest.ts` provides `readDeployedManifest()`, used by YAML-driven kinds. It translates only `ENOENT` into a labeled "deploy first" message, preserving the original error for all other codes so `EISDIR` or `EACCES` surfaces its real cause. Every parser narrows parsed-`unknown` data through `host/parse.ts` (`isRecord`, `requireRecord`, `requireStringArray`), so the record predicate lives once and rejection messages share one shape instead of each module re-improvising validation.

See command-pipeline.md for the `command` kind's scope and step vocabulary, and release.md for the `release` kind's version reconciliation and the `remoteInstaller` kind's integrity-checked download and execution.

## Selection Manifests

`coderAgents`, `coderSkills`, and `zedSettings` are filtered by a per-surface selection manifest under `~/.mev/`. See docs/config.md for the catalog sources, the manifest IO contract, opt-in/opt-out polarity, and the Zed settings-merge algorithm.

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
