# Contributing

## Scope

`mev` is a macOS development environment provisioning CLI built with Bun and TypeScript.

The repository owns:

- the CLI entrypoint in `src/mev/main.ts`
- the CLI boundary in `src/mev/cli/`
- the application layer in `src/mev/app/`
- the repository-owned tests in `tests/`
- the validation surface in `package.json`
- the GitHub Actions automation in `.github/workflows/`

## Local Verification

`bun` is the canonical local task surface.

The repository-owned tasks are:

- `bun run mev <command>`
- `bun run build`
- `bun run fix`
- `bun run check`
- `bun run test`

`bun run fix` applies Biome formatting and safe lint fixes.
`bun run build` compiles a standalone executable with `bun build --compile`
without leaving intermediate files in the repository root.
`bun run check` runs Biome validation and TypeScript typechecking.
`bun run test` runs the Bun test suite.

## Runtime Version

The Bun version is fixed by the `packageManager` field in `package.json`.
Local development and GitHub Actions read the same repository-owned version.
