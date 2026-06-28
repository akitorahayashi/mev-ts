# Testing Guide

Testing in mev-ts is structured into Unit Tests and Integration Tests.

## Principles and Classification

Tests assert externally observable behavior at the boundary that owns it. We differentiate between two suites based on execution boundaries and dependencies:

### Unit Tests
- Placed next to the source code under the src/ directory tree with a .test.ts suffix.
- Verify pure transformations, data contracts, and presentation rendering.
- Must not perform any filesystem actions, process execution, or network calls.
- Run locally with bun run test:unit.

### Integration Tests
- Placed under the tests/ directory tree.
- Verify actions interacting with the filesystem, CLI routing, stdout/stderr, subprocess execution, or network contracts.
- Even if they use fakes like a fake CommandRunner, they belong to the integration suite if they validate external CLI arguments, process sequence, exit codes, or side-effects.
- Run locally with bun run test:integration.

## Execution and Discovery

### Test Commands
- bun run test: runs all unit and integration tests.
- bun run test:unit: runs unit tests under src/.
- bun run test:integration: runs integration tests under tests/.

Before each of these test runs, the pre-hook automatically builds the embedded asset registry code.

### Test Discovery (bunfig.toml)
- We do not use the root configuration in bunfig.toml, letting Bun discover test files in both src/ and tests/ directories.
- We configure pathIgnorePatterns to exclude references/ and .tmp/ directories, preventing Bun from scanning temp files or external repository checkouts.

## Asset Registry Codegen
The file src/assets/registry.generated.ts is excluded from Git control. The codegen pre-hooks (pretest, pretest:unit, pretest:integration) ensure it is built prior to running any tests, supporting clean checkouts on local dev and CI.

## Layer Map

### Unit Tests (src/)

| Area | Module | Focus |
|---|---|---|
| Scope | src/identity/scope.test.ts | Pure name and alias resolution for git scopes |
| Identity Store Helpers | src/identity/store.test.ts | String trimming and config path resolution |
| Profile Resolution | src/provisioning/profile.test.ts | MacBook/Mac Mini alias checks and usage error validation |
| Reconcile Envelope | src/provisioning/activation/reconcile.test.ts | Concurrent step order reporting and isolation of throwing failures |
| Registry Invariants | src/provisioning/registry.test.ts | Verification that registered targets reference valid asset keys |
| Target List Rendering | src/cli/tty/targetlist.test.ts | Target and tag column formatting without TTY codes |
| Identity Rendering | src/cli/tty/identities.test.ts | TTY/non-TTY layout of current and unmanaged scopes |
| Make Log Rendering | src/cli/tty/makelog.test.ts | Duration formatting and result summaries for make runs |
| Coder Catalog | src/provisioning/coder/catalog.test.ts | Catalog order sorting and section mismatch validation |
| Coder Manifest | src/provisioning/coder/manifest.test.ts | Filter logic to enable or disable specific workspace assets |
| GitHub Labels | src/internal/gh/labels.test.ts | Manifest catalog size verification |
| Branch Verification | src/internal/git/branches.test.ts | Rejection of empty branch tokens |
| Clone Verification | src/internal/git/clone.test.ts | Validation of empty checklists and flags-only inputs |
| Submodule Verification | src/internal/git/submodule.test.ts | Input traversal and path sanitation checks |

### Integration Tests (tests/)

| Area | File | Focus |
|---|---|---|
| CLI Routing | tests/cli/program.test.ts | Routing, argv parsing, exit codes, and stdout/stderr capture |
| Filesystem Store | tests/identity/store.test.ts | File reading, writing, and serialization format validations |
| Coder Activation | tests/provisioning/coder.test.ts | Creation of Claude rules and skills symlinks |
| Activation DSL | tests/provisioning/activation.test.ts | Link creation and cleanups in temp directories |
| Deploy Phase | tests/provisioning/deploy.test.ts | materialize role files in ~/.config/mev/ |
| Provisioning Orchestration | tests/provisioning/run.test.ts | Order of execution between deploy, packages, and activations |
| Brew Actions | tests/brew/install.test.ts | Temporary Brewfile materialization and homebrew installs |
| GitHub CLI | tests/internal/gh/*.test.ts | Auth status, label synchronization, and API contracts |
| Git Wrappers | tests/internal/git/*.test.ts | Checkout, branch pruning, submodule deinit, and directory cleanups |
| Activations (duti, pipx, defaults, release, command) | tests/provisioning/*.test.ts | Command pipelines, defaults plist changes, and pipx inject calls |

## Development Rules

### Adding a New Test
- For pure functions, validation checks, formatting logic, or data mapping, create a test next to the source module under src/ with a .test.ts extension.
- For tests performing real I/O, writing files, checking command execution arguments/output, or executing full orchestration flows, add them under the tests/ folder.

### Sandbox Directories
- Integration tests writing to the disk must restrict all writes to .tmp/ sandbox directories.
- Sandboxes are created in a beforeEach hook and removed in an afterEach hook to clean up the workspace.

### Output and Process State
- Clean up any modified environment variables, process flags, or spied methods.
- Do not let stdout/stderr spillage contaminate the test output runner.

### External Resources
- Never make real HTTP requests or call real external binary commands during tests.
- Inject fake contexts or inject mock CommandRunner parameters to assert on arguments and return codes.

## Continuous Integration (CI)
Our run-tests.yml Action runs a parallel matrix job for unit and integration suites on ubuntu-latest. Both suites run independently, ensuring complete code validation before any branch merges.

### Adding a New Activation Kind
- Add the variant type to the Activation union in src/provisioning/activation/contract.ts.
- Create a tool wrapper capability under src/ if calling external binaries.
- Implement the activation runner under src/provisioning/activation/.
- Route it in src/provisioning/activation/dispatch.ts.
- Create an integration test under tests/provisioning/ to verify changed, unchanged, and failed statuses, command executions, and plan mode.

### Adding a New Target
- Add the target file under src/provisioning/targets/ and register it in src/provisioning/registry.ts.
- Uniqueness and asset existence are validated automatically by the unit test at src/provisioning/registry.test.ts. No new test file is required.
