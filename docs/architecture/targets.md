# Provisioning Targets

## Target contract

Each target is a file registered in `provisioning/registry.ts`:

| Field | Meaning |
|---|---|
| `name`, `aliases` | Canonical selector and alternate selectors |
| `role` | Asset namespace under `src/assets/config/` |
| `packages` | Required Homebrew formulae, taps, and casks |
| `activations` | Ordered activation declarations |
| `preserveBeforeDeploy` | Optional target-specific preservation hook |
| `optional` | Excluded from full-environment selection when true |
| `perMachineInputs` | Machine facts materialized into target output |

`make` resolves explicit selectors. `create` and `sync` use the registered
non-optional selection; all three use the same provisioning phases.

## Semantic synchronization

| Input | Sync behavior |
|---|---|
| Target declaration | Hash canonical name, role, package requirements, and activation intent. |
| Embedded role | Hash asset keys, contents, and executable attributes. |
| Per-machine input | Invalidate affected applied markers when a materialized value changes; never include it in the signature. |
| Applied marker | Store the successful signature atomically under `~/.mev/applied/{target}`. |
| Deployed role | Select when paths, contents, or executable attributes drift. |
| Upgrade mode | Applies only after selection; never changes signatures or selection. |

Command activation declarations contribute their data to the signature; the
command vocabulary is defined in [command-pipeline.md](command-pipeline.md).

`runMake()` invalidates selected markers before deployment and records them only
after deploy, package resolution, and activation succeed. A failed run therefore
remains selected for the next sync.

The registry test validates target asset existence and selector uniqueness for
every registered target; adding a target does not require a new test file.
