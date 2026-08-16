# Agent Plugins

`agentPlugins` reconciles the plugin state declared for Claude Code and Codex.
The catalog format is owned by [docs/config.md](../config.md); this document
defines the lifecycle and ownership contract.

## Desired state

| Declaration | Required state |
|---|---|
| `marketplaces[].plugins` | Installed and enabled. |
| `marketplaces[].uninstall` | The named plugin is absent. |
| `removed_marketplaces` | The owned marketplace and its namespace are absent. |
| Omitted removal list | No removal is implied. |

Marketplaces identify GitHub repositories and use the fixed `main` ref through
the per-machine SSH host. A plugin ID includes its marketplace name.

## Ownership boundary

| Host state | Treatment |
|---|---|
| Registration from the declared repository | Reconciled to the declared source and ref. |
| Explicitly declared plugin | Installed, enabled, and verified. |
| Explicit uninstall declaration | Uninstalled and verified absent. |
| Explicit marketplace removal | Removed only after the registered source matches the tombstone. |
| Same-named foreign, non-Git, or built-in marketplace | Refused; user state is not replaced or removed. |
| Unlisted plugin | Preserved unless a client-required namespace replacement removes it as a side effect. |

Claude ownership is limited to the user scope. A same-ID plugin in another scope
does not satisfy a declaration or fail a user-scope removal.

## Lifecycle

| Stage | Contract |
|---|---|
| Inventory | Read each participating client's plugin state locally. |
| Explicit removal | Remove declared plugins before marketplace work. |
| Marketplace | Add, refresh, or re-register only when a plugin is missing, upgrade mode is active, or the owned source has drifted. |
| Enablement | Enable an installed-but-disabled declaration locally; it does not fetch the marketplace. |
| Verification | Declared plugins must be present and enabled; removed plugins must be absent. |

Source identity is the repository `owner/name`; an SSH alias or missing ref is
transport drift within mev's ownership. A different repository is foreign.

## Removal safety

1. Verify that the registered marketplace belongs to the removal declaration.
2. Uninstall every plugin covered by that marketplace removal.
3. Re-inventory and require those plugins to be absent.
4. Deregister the marketplace only after verification succeeds.

A successful process exit is not removal proof. A survivor or unavailable
verification blocks deregistration. An already absent registration can still have
orphaned plugins in its namespace, which the tombstone removes.

## Upgrade

Upgrade is execution intent, not desired state or signature input. It refreshes
declared marketplaces and re-resolves installed declared plugins. Enablement is
independent, so an upgraded disabled plugin is enabled in the same run.

The post-run inventory settles the outcome. A pure upgrade can be unchanged when
both versions match; a missing version cannot prove a no-op and remains changed.
Installation, enablement, or re-registration is always a host change.

## Client constraints

Capability adapters absorb command vocabulary. Only behavioral differences that
affect reconciliation remain here:

| Client | Constraint |
|---|---|
| Claude Code | Reports the marketplace ref; same-repository source drift can be corrected in place; upgrading does not enable a disabled plugin. |
| Codex | Does not report the marketplace ref; replacing a drifted registration can remove its namespace, so declared plugins are reinstalled; re-adding also enables. |

## Sources of truth

| Responsibility | Authority |
|---|---|
| Catalog schema | `src/agent-plugin/catalog.ts` |
| Client protocols | `src/agent-plugin/claude.ts`, `src/agent-plugin/codex.ts`, `src/agent-plugin/client.ts` |
| Reconciliation | `src/provisioning/activation/agent-plugins.ts` |
| Boundary tests | `tests/provisioning/agent-plugins.test.ts` |
