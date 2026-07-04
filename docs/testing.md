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
- Integration tests that write to disk use `tests/fixtures/temporary-directory.ts`, which allocates one directory per test under the system temporary root and removes only the directory it created.
- Never make real HTTP requests or call real external binaries; inject fake contexts or a fake `CommandRunner`.
- Clean up any modified env vars, process flags, or spies; don't let stdout/stderr spillage contaminate the test runner.

## CI

`run-tests.yml` runs the unit and integration suites as parallel matrix jobs on `ubuntu-latest`.
