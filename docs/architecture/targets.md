# Provisioning Targets (provisioning/targets/)

Each target is a self-contained file registered in `provisioning/registry.ts`. A target owns:
- `name` and display description
- `aliases` for alternate selector resolution
- `role` — the asset namespace under `src/assets/config/`
- `packages` — Homebrew formulae, taps, and casks required before activation
- `preserveBeforeDeploy` — optional protection for target-specific mutable host state that role replacement would destroy, beyond the paths its activation kinds already declare preserved
- `activations` — ordered list of `Activation` values
- `optional` — when set, the target is selectable by name or alias but excluded from a full-environment `create`
- `perMachineInputs` — per-machine facts the target bakes into its applied output, declared only where the value is materialized

`make` resolves explicit selectors; `create` provisions `fullSetupTargets()` — every registered target except the optional ones, in declaration order — through the same three phases. `sync` scans that same selection and submits only changed targets to one `runMake()` call. The set derives from the registry, so a new target joins both full-environment commands without a separate list.

## Semantic synchronization

`signature.ts` hashes the user-visible desired state of a target: canonical name and role, normalized package requirements, embedded role asset keys/content/executable status, and activation intent in declaration order. Non-command activations contribute their declarative fields. Command activations are themselves declarative: they contribute their label, asset reads, and per-step data — argv tokens (literal/`ref`/`splitRef`/`concat`), env values (including a `pathList` form), `skipIf` guard tokens, captures, and change-classification declarations. This step data is resolved at apply time against a scope of reads and captures plus the reserved `home` and `basePath`; because the signature hashes the same data, editing a command's argv, env, or guard flips the signature, with no manual version counter.

The signature proving that each target is currently applied is stored atomically at `~/.mev/applied/{target}`. `runMake()` invalidates selected target signatures before deployment and records each signature again only after that target's deploy, package resolution, and activation complete successfully. A failed or interrupted run therefore remains selected even when deployment repaired its role drift before a later phase failed. This state is shared by `make`, `create`, and `sync` rather than owned by the sync command.

Configuration commands invalidate an affected target's applied marker when they change per-machine input that is intentionally outside the declaration signature. `config ssh-host` derives its invalidation set from `perMachineInputs`: Grove renders the alias into its deployed catalog, and the coder target's agent plugins persist it inside each client's marketplace registrations, so both are marked stale before the host store is written and the next `sync` reselects them — Grove re-renders, and the plugin activation's registration probe re-registers the drifted marketplaces. A target that only reads a fact live, without materializing it anywhere, declares nothing and is never stale for it. A failed host write remains safe because the absent marker over-selects rather than suppressing a needed application.

`scan.ts` compares current and applied signatures and separately compares each embedded role tree with `~/.mev/roles/{role}/`, including paths, contents, and executable attributes. A signature mismatch or deployed drift selects the target. Scans run concurrently, while selected targets run through one normal provisioning plan so Homebrew and activation writes retain their established ordering. Optional targets are outside the scanned selection.

Upgrade mode never widens this selection: `sync --upgrade` applies upgrade mode only within the targets the scan already selected, so a synchronized environment exits without provisioning or network access. A deliberate full refresh of latest-assumed tools is `create --upgrade` or `make <target> --upgrade`.

The registry test (`src/provisioning/registry.test.ts`) validates asset existence and selector uniqueness automatically for all registered targets. Adding a target does not require new test files.
