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

## Documents

- cli.md — command registration, dispatch, and the error/exit-code model
- provisioning.md — the 3-phase engine and the preservation boundary
- targets.md — target shape, registry-driven selection, and semantic sync
- activation.md — the activation DSL, the kind table, the reconcile envelope, shared manifest vocabulary, selection manifests, and the capability module boundary
- agent-plugins.md — the agentPlugins reconciler and the codexConfig ownership inversion
- command-pipeline.md — the command activation kind's scope and step vocabulary
- release.md — release binary reconciliation and reviewed remote installers
- host.md — Context assembly and CommandRunner's contract
- assets.md — asset embedding, codegen, and the deploy store layout
- identity.md — the Git identity domain
- document.md — Markdown/PDF conversion mechanics
