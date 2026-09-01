# Activation DSL

Targets declare provisioning work with factories from `provisioning/activation/`.
The runtime dispatches by `Activation['kind']` through one registry.

## Kinds

| Kind | Factory | Contract |
|---|---|---|
| `file` | `link(source, dest)` | Reconciles one deployed asset as a symlink. |
| `groveConfig` | `groveConfig(source, dest)` | Renders the per-machine GitHub host and materializes the catalog. |
| `tree` | `linkTree(prefix, dest)` | Mirrors a deployed asset prefix and removes managed stale links. |
| `defaults` | `applyDefaults(configKey)` | Applies a declared macOS defaults manifest. |
| `duti` | `applyDuti(configKey)` | Applies declared file associations. |
| `pipx` | `applyPipx(configKey)` | Reconciles pipx tools, injections, post-installs, and explicit removals. |
| `pnpm` | `applyPnpm(configKey)` | Reconciles global pnpm packages and explicit removals. |
| `editorExtensions` | `installExtensions(command, configKey)` | Reconciles an editor's declared extensions. |
| `coderAgents` | `coderAgents(sectionsPrefix, dests)` | Fans out selected embedded agent sections. |
| `coderSkills` | `coderSkills(skillsPrefix, targetDirs)` | Fans out selected embedded skill files. |
| `agentPlugins` | `installAgentPlugins(configKey, pathPrefix)` | Reconciles declared Claude Code and Codex plugins. See [agent-plugins.md](agent-plugins.md). |
| `zedSettings` | `zedSettings(base, overridesPrefix, dest)` | Builds settings from a base asset and selected overrides. |
| `declaredKeys` | `declaredKeys(source, dest, format)` | Enforces declared keys in an app-owned document. See [app-owned-config.md](app-owned-config.md). |
| `command` | `runCommand({ label, reads?, steps })` | Runs an ordered declarative host-command pipeline. See [command-pipeline.md](command-pipeline.md). |
| `release` | `releaseBinaries(binaries)` | Reconciles versioned release binaries. See [release.md](release.md). |
| `remoteInstaller` | `remoteInstaller(options)` | Runs an integrity-reviewed remote installer. See [release.md](release.md). |

## Kind registry

`kinds.ts` is the authority for each kind's description, runner, referenced
assets, and build-time parser. Dispatch, asset validation, and registry tests
look up the same table, so adding a kind is a single union-and-registry change.

## Reconcile envelope

Multi-item kinds share the following boundary:

| Stage | Contract |
|---|---|
| Declare | Resolve the items; a declaration failure aborts the activation. |
| Build steps | Probe shared state and create one step per item; a probe failure aborts the activation. |
| Execute | Isolate item failures and continue with independent siblings. |
| Report | Convert each probe result into a user-managed resource outcome. |
| Concurrency | Serial by default; parallelism is opt-in for independent work. |

`coderAgents` and `coderSkills` apply the same per-item failure boundary to their
fan-out without using this envelope.

## Outcome contract

An activation returns an `ActivationDescription` and `ResourceOutcome[]`.
Descriptions name the user-facing subject and optionally identify a collection
whose unchanged members may be aggregated. Each outcome names the affected
path, setting, package, association, runtime, plugin, or other managed resource.

| Status | Meaning |
|---|---|
| `changed` | A probe established that the resource changed. |
| `unchanged` | A probe established that the resource was already current. |
| `applied` | An action succeeded, but its underlying state change was not independently observable. |
| `failed` | The resource could not be reconciled. |
| `blocked` | A prerequisite or earlier resource prevented reconciliation. |

Activation and target statuses are derived from outcomes. Failures outrank
blocks, observed changes, applied actions, and unchanged results. Internal role
names, manifests, signatures, and applied markers are not success resources;
their failures remain visible with phase context.

## Manifest and selection boundaries

Manifest-backed kinds parse deployed assets at build time with the same parser
used at apply time. Shared version manifests use `latest` or an exact pin;
`latest` is re-resolved only in upgrade mode, and removal is always explicit.
Selection manifests and their opt-in/opt-out polarity are owned by
[docs/config.md](../config.md).

## Capability boundary

Capability modules own an external tool's protocol, output format, and platform
state probes. Activation modules depend on capabilities through `Context`; the
capability layer does not import activation contracts. This keeps external
protocol changes out of the activation DSL.
