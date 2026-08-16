# Architecture

`mev` is Local IaC for macOS. Repository configuration is the source of truth;
the compiled binary carries the configuration assets it deploys.

## Provisioning phases

| Phase | Responsibility |
|---|---|
| Preserve | Protect mutable host state before a role can replace it. |
| Deploy | Reconcile selected role assets in the deploy store. |
| Install | Resolve required Homebrew packages. |
| Activate | Apply each declared activation in target order. |

## Layer map

| Domain | Responsibility |
|---|---|
| `cli/` | Argument parsing, command routing, exit codes, and terminal rendering |
| `app/` | Use-case orchestration for identity and config selection |
| `provisioning/` | Targets, activations, signatures, and the provisioning phases |
| `agent-plugin/` | Claude Code and Codex inventories and marketplace protocols |
| `coder/`, `zed/`, `config-selection/` | Catalogs, manifests, and selected generated configuration |
| `brew/`, `defaults/`, `duti/`, `editor/`, `pipx/`, `pnpm/` | External tool protocols |
| `host/` | Context, subprocesses, files, parsing, transactions, and shared host boundaries |
| `assets/`, `identity/`, `git/`, `internal/` | Embedded assets, Git identity, Git helpers, and hidden document/Git commands |

## Documents

- [cli.md](cli.md) — command routing and error/exit contracts
- [provisioning.md](provisioning.md) — preservation and the provisioning phases
- [targets.md](targets.md) — target shape, signatures, and semantic sync
- [activation.md](activation.md) — the activation DSL and shared execution boundaries
- [agent-plugins.md](agent-plugins.md) — plugin ownership and reconciliation
- [app-owned-config.md](app-owned-config.md) — declared key ownership and deploy protection
- [command-pipeline.md](command-pipeline.md) — the command activation vocabulary
- [release.md](release.md) — release binaries and remote installer safety
- [worktrees.md](worktrees.md) — worktree layout and cleanup safety
- [host.md](host.md) — Context and CommandRunner contracts
- [assets.md](assets.md) — asset embedding and the deploy store
- [identity.md](identity.md) — Git identity ownership
- [document.md](document.md) — Markdown/PDF conversion boundaries
