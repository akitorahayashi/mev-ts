# Testing Guide

Tests assert externally observable behavior at the boundary that owns it, split into two suites by execution boundary.

## Unit Tests (src/)

Colocated `*.test.ts` files next to source. Verify pure transformations, data contracts, and presentation rendering. No filesystem, process, or network access. Run with `bun run test:unit`.

## Integration Tests (tests/)

Files under `tests/`. Verify filesystem, CLI routing, subprocess execution, or network contracts — including tests that use fakes (e.g. a fake `CommandRunner`) but assert on CLI arguments, process sequence, exit codes, or side-effects.

## Commands

`bun run test` / `bun run test:unit` / `bun run test:integration`. A pre-hook regenerates the embedded asset registry before each run; `src/assets/registry.generated.ts` is gitignored.

## Rules

- New tests: pure logic goes under `src/`; real I/O or full orchestration goes under `tests/`.
- Integration tests that write to disk use `tests/fixtures/temporary-directory.ts`: `withTemporaryDirectory` allocates one directory per test under the system temporary root and removes only what it created, and `sandboxedTest(prefix)` is the `test` variant that passes that directory to the body.
- Never make real HTTP requests or call real external binaries; inject a fake through the shared fixtures. `tests/fixtures/fake-context.ts` provides `recordingContext` (a `Context` whose runner records every invocation and answers with an injected `Responder`), the `respondByCommand` helper that dispatches by command name, and `emptyAssets`. The `Responder` may be async and side-effecting (for example writing a downloaded file), so tests inject through `recordingContext` rather than rebuilding a `Context`. `tests/fixtures/fake-command-runner.ts` provides the lower-level `sequenceRunner`/`presetRunner`.
- CLI and progress rendering use `tests/fixtures/streams.ts`: `captureStreams` buffers stdout/stderr for assertion, and `fakeTtyStream` is a fake TTY `WriteStream` that drives the animated progress path without the real process streams.
- `Context` carries an injectable `tmpRoot`, so a test confines a command's scratch files to a sandbox directory rather than the real system temporary root.
- Host filesystem primitives that stage atomically (`atomic-file`, `directory-replacement`, `transaction`, `symlink`, `managed-links`) have direct integration tests under `tests/host/`; the make planner is covered by a colocated pure test.
- Clean up any modified env vars, process flags, or spies; don't let stdout/stderr spillage contaminate the test runner.

## CI

Every workflow job pins `macos-15`, matching the macOS-only product surface. `run-tests.yml` runs the unit and integration suites as parallel matrix jobs; `run-static-checks.yml` runs `bun run check`; `run-build.yml` compiles the binary and smoke-tests it.
