# mev

`mev` is a macOS development environment provisioning CLI built with Bun and TypeScript.

## Setup

```bash
bun install
```

## Usage

```bash
bun run mev make git          # Provision the git feature
bun run mev make git --plan   # Show what would change without applying
bun run mev --help
bun run mev --version
```

A feature declares the resources it owns (Homebrew formulae, deployed config
assets, symlinks, git config). `make` resolves the selected tags to features,
normalizes their resources into a dependency graph, inspects the host in
parallel, and applies only the resources that diverge from desired state.

## Task Surface

```bash
bun run build
bun run check
bun run test
```

`bun run fix` applies Biome formatting and safe lint fixes.

## Runtime

The package is ESM via `type: "module"` in `package.json`.
The CLI entrypoint is `src/mev/main.ts`.
The command-line boundary lives under `src/mev/cli/` and uses `cac` for
command declaration, help, option parsing, and required argument validation.
The application layer lives under `src/mev/app/`.
Tests live under `tests/`.
`bun run build` compiles a standalone executable to `dist/mev`.
Intermediate build files are isolated under `./.tmp/` and cleaned after the
build completes.
