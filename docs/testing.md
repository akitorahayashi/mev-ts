# Testing

## Principle

Tests assert externally observable behavior at the boundary that owns it. Internal composition — which resources a feature lists, how the executor schedules inflight work internally, wording of generated output — is not frozen unless it is the explicit contract of that boundary.

## Layer Map

| Layer | File(s) | Technique | Real I/O |
|---|---|---|---|
| Graph (dedup, cycles, missing deps) | `tests/resources/graph.test.ts` | Inline `Resource` stubs | None |
| Executor (scheduling, concurrency, blocked cascade) | `tests/resources/executor.test.ts` | `stub()` helper; `delay()` for timing assertions | None |
| Filesystem provider | `tests/providers/filesystem.test.ts` | Real temp dir under `.tmp/` | `.tmp/fs-<pid>-<n>/` |
| Brew provider | `tests/providers/brew.test.ts` | Fake `CommandRunner` | None |
| Git provider | `tests/providers/git.test.ts` | Fake `CommandRunner` | None |
| App use-case (runMake) | `tests/app/make.test.ts` | Injected fake `Context` | None |
| CLI (exit code, help, version) | `tests/cli/program.test.ts` | String argv; spy on stdout/stderr | None |
| Feature registry invariants | `tests/config/registry.test.ts` | Iterates `allFeatures()` | None |

## Context Injection

`Context` carries `home`, `overwrite`, `commands` (CommandRunner), and `assets` (AssetSource). Every provider and the app layer accept it as a parameter; tests supply a hand-built value rather than calling `createContext`. This eliminates the need to mock modules or spawn real processes.

## Fake CommandRunner

Command-based providers (brew, git, and any future provider that shells out) are tested with a fake `CommandRunner` — a plain async function that records the `args` it receives and returns a preset `{ code, stdout, stderr }`. The tests assert on recorded `args` and on the `ResourceState` or `ApplyResult` the provider derives from the exit code.

Real `brew` and `git` binaries are never invoked. Their contract (what exit codes mean, what flags do) is the provider's test premise, not its test subject.

## Real Temp Dirs

The filesystem provider creates real files and symlinks, so its tests use real directories. Each test gets a unique sandbox under `.tmp/fs-<pid>-<counter>/` created in `beforeEach` and deleted in `afterEach`. The `.tmp/` directory is git-ignored. No test writes outside `.tmp/`; the `home` value passed to `contextFor()` is always the sandbox path.

## What is Deliberately Not Tested

Feature-level end-to-end tests (provision a full feature against a fake home) are not present. Idempotency across a full feature is the composition of individual provider idempotency (covered by provider tests) and executor logic (covered by executor tests). Maintaining a feature-scoped integration harness would cost more than it catches, and a broken deployment is recoverable with `mev make <tag>` on the real machine.

## Adding a New Provider

1. Create a fake `CommandRunner` in a new `tests/providers/<name>.test.ts`.
2. Cover: correct argv construction per state, correct `ResourceState` per exit code, error path (`ProvisioningError` on failure).
3. If the provider writes to the filesystem (not just shells out), use a real temp sandbox as in `filesystem.test.ts`.

## Adding a New Feature

Adding a feature to `config/registry.ts` requires no new test files. The graph and executor tests are feature-agnostic, and `tests/config/registry.test.ts` iterates `allFeatures()` to enforce, for every feature including new ones:

- `buildGraph(feature.resources)` does not throw (no missing deps, no cycles, no id collisions).
- Every embedded-asset id (`fs:asset:<key>`) a feature references resolves in the asset registry.
- No two features share a tag or alias.

These are parametric over the registry rather than per-feature, so a malformed new feature is caught without bespoke tests. The app test (`make.test.ts`) covers the use-case pipeline with a fake context, not feature content.
