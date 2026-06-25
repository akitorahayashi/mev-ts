# mev

`mev` is a macOS development environment provisioning CLI built with Bun and TypeScript.

## Setup

```bash
bun install
```

## Usage

```bash
bun run mev make git           # Provision the git feature
bun run mev make git shell      # Provision multiple features at once
bun run mev make shell --plan   # Show what would change without applying
bun run mev --help
bun run mev --version
```

A target declares the Homebrew packages it requires and the activations it owns
(symlinks, macOS defaults writes, host-command pipelines). `make` resolves the
selected tags to targets, deploys their embedded config assets, installs missing
packages, then runs each activation idempotently.
