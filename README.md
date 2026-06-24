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

A feature declares the resources it owns (Homebrew formulae, deployed config
assets, symlinks, git config). `make` resolves the selected tags to features,
normalizes their resources into a dependency graph, inspects the host in
parallel, and applies only the resources that diverge from desired state.
