# bun-cli

`bun-cli` is a Bun and TypeScript template repository for command-line tools.

The repository demonstrates a small CLI with a framework-backed command
boundary, one command, `greet <name> [--lang <en|ja>]`, repository-owned checks,
tests, and a compiled binary build.

## Setup

```bash
bun install
```

## Usage

```bash
bun run bun-cli greet Alice
bun run bun-cli greet Hanako --lang ja
bun run bun-cli --version
```

## Task Surface

```bash
bun run bun-cli greet Alice
bun run build
bun run check
bun run test
```

`bun run fix` applies Biome formatting and safe lint fixes.

## Runtime

The package is ESM via `type: "module"` in `package.json`.
The CLI entrypoint is `src/bun_cli/main.ts`.
The command-line boundary lives under `src/bun_cli/cli/` and uses `cac` for
command declaration, help, option parsing, and required argument validation.
The application layer lives under `src/bun_cli/app/`.
The greeting feature owner lives under `src/bun_cli/greetings/`.
Tests live under `tests/cli/`, `tests/app/`, and `tests/greetings/`.
`bun run build` compiles a standalone executable to `dist/bun-cli`.
Intermediate build files are isolated under `./.tmp/` and cleaned after the
build completes.
