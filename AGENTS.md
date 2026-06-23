# Agent Guide

## Purpose

macOS development environment provisioning CLI built with Bun and TypeScript.

## Runtime

- Use Bun commands only.
- Keep the package as ESM with `type: "module"` in `package.json`.
- Install dependencies with `bun install`.
- Run the CLI with `bun run mev <command>`.
- Build the standalone binary with `bun run build`.
- Apply repository formatting with `bun run fix`.
- Run static validation with `bun run check`.
- Run tests with `bun run test`.

## Development Rules

- Keep dependencies minimal and clearly justified.
- Delegate the user-facing command-line boundary to `cli-kit`'s `runCli` (help rendering, routing, version, exit-code mapping). `program.ts` supplies metadata, registers `make`/`list`/`user`, and intercepts `internal` before delegating. Command files import `CAC` and `CommandOutcome` from `cli-kit`, not `cac`; cac is a transitive dependency.
- `user` is registered as `user [scope]` with alias `us`; the optional positional routes to show (no arg), setup (`set`), or switch (scope alias). The `internal` subcommand uses hand-rolled dispatch (`cli/internal.ts`) because `cac` cannot handle multi-word commands with trailing variadic and `--` separators; it is intercepted in `program.ts` ahead of `runCli` rather than registered as a cac command.
- Domain errors extend `AppError` from `cli-kit`; `errors.ts` re-exports the base classes and adds `ProvisioningError`.
- Keep the CLI surface small and explicit.
- Keep the structure aligned to `cli/`, `app/`, and feature-owned modules under `src/`.
- Do not add silent fallback behavior.
- Keep tests focused on externally observable behavior.
- Do not read `.mx/*.md` unless explicitly requested by the user.
