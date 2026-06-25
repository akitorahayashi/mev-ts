# Testing

## Principle

Tests assert externally observable behavior at the boundary that owns it. Internal composition — which activation a target lists, how the runner schedules work internally, wording of generated output — is not frozen unless it is the explicit contract of that boundary.

## Layer Map

| Layer | File(s) | Technique | Real I/O |
|---|---|---|---|
| Activation (symlink, tree) | `tests/provisioning/activation.test.ts` | Real temp dir under `.tmp/` | `.tmp/activate-<pid>-<n>/` |
| Activation (command pipeline) | `tests/provisioning/command.test.ts` | Fake `CommandRunner`; real temp dir for `pathExists` guard | `.tmp/cmd-<pid>/` |
| Deploy (role materialization) | `tests/provisioning/deploy.test.ts` | Real temp dir | `.tmp/` |
| Run (3-phase orchestrator) | `tests/provisioning/run.test.ts` | Injected fake `Context` | None |
| Registry invariants | `tests/provisioning/registry.test.ts` | Iterates `allTargets()` | None |
| Brew install | `tests/brew/install.test.ts` | Fake `CommandRunner` | None |
| App identity (show/set/switch) | `tests/app/identity.test.ts` | Fake `CommandRunner` + real temp home | `.tmp/` |
| Identity scope resolution | `tests/identity/scope.test.ts` | Pure functions | None |
| Identity store (load/save) | `tests/identity/store.test.ts` | Real temp home | `.tmp/` |
| CLI (exit code, help, version, routing) | `tests/cli/program.test.ts` | String argv; spy on stdout/stderr | None |
| Identity render (`user` table) | `tests/cli/user.test.ts` | `IdentityView` literals | None |
| Target listing | `tests/cli/list.test.ts` | `allTargets()` | None |
| Internal git (clone, delete-branches, delete-submodule) | `tests/internal/git/*.test.ts` | Fake `CommandRunner`; real temp dir for submodule | `.tmp/submodule-<pid>-<n>/` |
| Internal gh (label, labels, api, auth, extension) | `tests/internal/gh/*.test.ts` | Fake `CommandRunner` | None |

## Context Injection

`Context` carries `home`, `overwrite`, `commands` (CommandRunner), and `assets` (AssetSource). Every provisioning function accepts it as a parameter; tests supply a hand-built value rather than calling `createContext`. This eliminates the need to mock modules or spawn real processes.

## Fake CommandRunner

Command-based tests use a fake `CommandRunner` — an async function that records the invocations it receives (command, args, options) and returns a preset `{ code, stdout, stderr }`. Tests assert on recorded invocations and on the report status the runner derives from the exit code.

Real binaries are never invoked. Their contract (exit codes, flags) is the test premise, not the test subject.

## Real Temp Dirs

Activation tests that exercise symlink creation and command `skipIf: pathExists` guards use real directories. Each test gets a unique sandbox under `.tmp/<prefix>-<pid>-<counter>/` created in `beforeEach` and deleted in `afterEach`. The `.tmp/` directory is git-ignored. No test writes outside `.tmp/`.

## Registry Test

`tests/provisioning/registry.test.ts` iterates `allTargets()` and enforces for every registered target:

- Every `file` and `defaults` activation references an asset key that exists in the embedded registry.
- Every `tree` activation's prefix resolves to at least one embedded asset.
- Every `command` activation's `reads` values reference existing embedded assets.
- No two targets share a tag or alias.

Adding a target to `registry.ts` is covered automatically; no per-target test file is required.

## What is Deliberately Not Tested

Target-level end-to-end tests (provision a full target against a fake home) are not present. Idempotency across a full target is the composition of individual activation idempotency (covered by activation tests) and the orchestration logic (covered by run tests). A broken deployment is recoverable with `mev make <tag>` on the real machine.

## Adding a New Activation Kind

1. Add the variant to the `Activation` union in `activation/contract.ts`.
2. Create a `<kind>.ts` module in `activation/` owning the factory and runner.
3. Add a `case` to both switches in `activation/dispatch.ts`.
4. Export the factory from `activation/index.ts`.
5. Add tests in `tests/provisioning/` covering the observable behavior at the activation boundary: changed/unchanged/failed status, idempotency, and plan mode.

## Adding a New Target

Add the target file under `src/provisioning/targets/` and register it in `src/provisioning/registry.ts`. The registry test covers asset existence and selector uniqueness automatically.
