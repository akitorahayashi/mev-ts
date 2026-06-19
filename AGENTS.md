
# Agent Guide

## Purpose

macOS development environment provisioning CLI built with Bun and TypeScript.

## Runtime

- Use Bun commands only.
- Keep the package as ESM with `type: "module"` in `package.json`.
- Install dependencies with `bun install`.
- Run the CLI with `bun run mev <command>`.
- Build the standalone binary with `bun run build`.
- Run static validation with `bun run check`.
- Run tests with `bun run test`.
- Apply repository formatting with `bun run fix`.

## Development Rules

- Keep dependencies minimal and clearly justified.
- Use `cac` as the command-line boundary for command declaration, help, option parsing, and required argument validation.
- Keep the CLI surface small and explicit.
- Keep the structure aligned to `cli/`, `app/`, and feature-owned modules under `src/mev/`.
- Do not add silent fallback behavior.
- Keep tests focused on externally observable behavior.
- Do not read `.mx/*.md` unless explicitly requested by the user.
