# Provisioning Phases

## Preservation boundary

Mutable host state is protected before applied markers are invalidated or roles
are replaced:

| Layer | Owner | Contract |
|---|---|---|
| Activation-preserved paths | Activation kind | Protects state whose ownership is implied by the activation, such as app-owned documents. |
| Target hook | Target | Protects state known only to that target, such as legacy Git identity keys. |
| Failure boundary | Provisioning | A preservation failure stops the run before managed state changes. |

## Phases

| Phase | Order and result | Blocking condition |
|---|---|---|
| Deploy | Reconcile each selected role in the deploy store. | A role failure blocks groups using that role. |
| Install | Resolve the deduplicated Homebrew requirements of the selection. | A failed required package blocks its target group. |
| Activate | Apply activations in declaration order within each target group. | A failed or blocked activation blocks the remaining activations in that target. A blocked group produces blocked activation reports. |

Activation kinds may parallelize independent work only when their own contract
declares that safe. The phase boundaries preserve Homebrew and activation order.

## Upgrade intent

`--upgrade` is execution intent, not desired state. It refreshes the kinds that
support latest-assumed values, never changes target signatures, and does not widen
the target selection made by `sync`.
