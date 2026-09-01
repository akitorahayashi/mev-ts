# Provisioning Phases

## Preservation boundary

Mutable host state is protected before applied markers are invalidated or roles
are replaced:

| Layer | Owner | Contract |
|---|---|---|
| Activation-preserved paths | Activation kind | Protects state whose ownership is implied by the activation, such as app-owned documents. |
| Target hook | Target | Protects state known only to that target, such as legacy Git identity keys. |
| Failure boundary | Provisioning | A preservation or marker-invalidation failure prevents that role from deploying and blocks its dependent resources; independent roles continue. |

## Phases

| Phase | Order and result | Blocking condition |
|---|---|---|
| Deploy | Reconcile each selected role in the deploy store. | A role failure blocks groups using that role. |
| Install | Resolve the deduplicated Homebrew requirements of the selection. | A failed required package blocks its target group. |
| Activate | Apply activations in declaration order within each target group. | A failed or blocked activation blocks the remaining activations in that target. A blocked group produces blocked activation reports. |

Activation kinds may parallelize independent work only when their own contract
declares that safe. The phase boundaries preserve Homebrew and activation order.

The deploy phase computes asset-level added, updated, and removed entries before
replacement. `sync` uses the same comparison for drift selection, and link
activations use it to report a managed-content update even when the symlink
itself was already correct.

## Progress and results

`runMake()` emits one typed event stream for phase progress. TTY clients render
only the active operation as a transient line; completed package and target
results are permanent. Non-TTY clients omit transient operations and render the
same completed results without ANSI control sequences.

Completed output is organized by target and user-managed resource. Changed,
applied, failed, and blocked resources remain individual. Unchanged members of
a declared collection are collapsed into a count, while explicit destination
paths remain individual. The final result contains aggregate counts, actionable
failures, and a retry command.

## Upgrade intent

`--upgrade` is execution intent, not desired state. It refreshes the kinds that
support latest-assumed values and upgrades the selected targets' installed
Homebrew formulae and casks. It never invokes `brew update`, changes target
signatures, or widens the target selection made by `sync`.
