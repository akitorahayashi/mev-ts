# Testing Guide

Tests assert the externally observable contract at the boundary that owns it.

## Test layers

| Layer | Location | Covers | Prohibitions |
|---|---|---|---|
| Unit | Colocated `src/**/*.test.ts` | Pure transformations, data contracts, and rendering | Filesystem, process, and network access |
| Integration | `tests/**/*.test.ts` | Filesystem, CLI routing, subprocess, and network contracts | Real HTTP requests |

Run `bun run test:unit`, `bun run test:integration`, or `bun run test`. Each
pre-hook regenerates the embedded asset registry.

## Fixtures and boundaries

| Concern | Fixture or rule |
|---|---|
| Temporary files | `withTemporaryDirectory` and `sandboxedTest` create and clean per-test sandboxes. |
| Command execution | `recordingContext`, `respondByCommand`, `sequenceRunner`, and `presetRunner` provide injected responders. |
| CLI streams | `captureStreams` and `fakeTtyStream` drive output and progress rendering. |
| Scratch paths | Inject `Context.tmpRoot`; never use the real temporary root. |
| Host primitives | Atomic and symlink boundaries have direct integration tests under `tests/host/`. |
| Cleanup | Restore environment variables, process flags, spies, and streams after each test. |

## Real process carve-outs

Real external processes are allowed only when the process or its output format
is the boundary under test:

| Subject | Process |
|---|---|
| Script tests | The script interpreter (`zsh` or `bash`) |
| `bunCommandRunner` | A real subprocess, because it is the spawn boundary |
| Git output formats | Git in a sandbox repository, when a fake would only restate the parser |

Every carve-out names its reason in the test. Other tests inject a fake through
the shared fixtures.

Interactive prompt and browser-print boundaries are reached through injected
seams rather than direct tests.

## CI

| Workflow | Responsibility |
|---|---|
| `run-tests.yml` | Unit and integration suites in parallel macOS matrix jobs |
| `run-static-checks.yml` | `bun run check` and shellcheck on Ubuntu |
| `run-build.yml` | Binary compilation and smoke test |
| Platform policy | Product-facing jobs use `macos-15`; platform-independent checks use Ubuntu. |
