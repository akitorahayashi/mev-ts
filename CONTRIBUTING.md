# Contributing

## Scope

The repository owns:

- the CLI entrypoint in `src/main.ts`
- the CLI boundary in `src/cli/`
- the application layer in `src/app/`
- the validation surface in `package.json`
- the GitHub Actions automation in `.github/workflows/`

## Local Verification

`bun` is the canonical local task surface.

The repository-owned tasks are:

- `bun run mev <command>`
- `bun e <command>`
- `bun run build`
- `bun run fix`
- `bun run check`
- `bun run test`
- `bun run test:unit`
- `bun run test:integration`

`bun run fix` applies Biome formatting and safe lint fixes. Run it before `check`; `check` is read-only and fails on unformatted code.
`bun run build` compiles a standalone executable with `bun build --compile`
without leaving intermediate files in the repository root.
`bun run check` runs Biome validation and TypeScript typechecking.
`bun run test` runs the entire Bun test suite.
`bun run test:unit` runs the unit tests under `src/`.
`bun run test:integration` runs the integration tests under `tests/`.
Before each test command runs, the asset registry code is automatically generated.

## Runtime Version

The Bun version is fixed by the `packageManager` field in `package.json`.
Local development and GitHub Actions read the same repository-owned version.
