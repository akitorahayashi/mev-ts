# mev

`mev` is a macOS development environment provisioning CLI built with Bun and TypeScript.

## Setup

Homebrew is a prerequisite; `mev` installs packages through it but does not
bootstrap it. Install it first:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Then install dependencies:

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
