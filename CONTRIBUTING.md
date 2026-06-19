# Contributing

## Scope

`bun-cli` is a Bun and TypeScript template repository for CLI projects.

The repository owns:

- the CLI entrypoint in `src/bun_cli/main.ts`
- the CLI boundary in `src/bun_cli/cli/`
- the application layer in `src/bun_cli/app/`
- the feature owner in `src/bun_cli/greetings/`
- the repository-owned tests in `tests/`
- the validation surface in `package.json`
- the GitHub Actions automation in `.github/workflows/`

## Local Verification

`bun` is the canonical local task surface.

The repository-owned tasks are:

- `bun run bun-cli greet <name>`
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
