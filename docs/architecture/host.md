# Host Boundaries

## Context

| Field | Contract |
|---|---|
| `home` | Root used to resolve symbolic host paths. |
| `commands` | Injected `CommandRunner` for subprocess work. |
| `assets` | Embedded `AssetSource`. |
| `basePath` | PATH captured when the default context is created. |
| `tmpRoot` | Scratch root for temporary work; tests replace it with a sandbox. |

Provisioning receives `Context` through dependency injection. Tests build a
hand-written context, so pure logic and orchestration do not need module mocks or
real process launches.

## Mutation ownership

Application mutation boundaries acquire one per-home lease before decision-making
reads and retain it through completion. This covers provisioning, sync scanning
and pruning, configuration selection, identity changes, and executable update
placement. Child sync starts only after self-update releases ownership. Read-only
operations and document conversion remain independent.

A competing operation fails immediately with the active operation and process;
there is no wait option. Owner metadata records a unique token, PID, host, and
operation. Reclamation requires the recorded PID to be absent on the same host.
An active or reused PID cannot establish staleness. Incomplete metadata, another
host, inconclusive liveness, and unexpected lease contents are preserved with a
failure. A token-checked transition retires only the same lease incarnation,
preventing competing stale-owner reclaimers from deleting a new owner's lease.

Low-level provisioning and filesystem functions consume the caller's ownership;
they do not reacquire it. The lease coordinates mev invocations, not independently
running agent clients or editors.

## CommandRunner

| Option | Contract |
|---|---|
| `env` | Overlays the inherited environment. |
| `cwd` | Sets the subprocess working directory. |
| `stdout`, `stderr` | `pipe` captures output; `inherit` forwards it. |
| `timeoutMs` | Optional positive millisecond deadline covering process exit and output completion; expiration terminates the owned process group and returns code 124 with a timeout diagnostic. |
| Spawn failure | Resolves as exit code 127 with the failure in stderr. |

Each invocation explicitly passes the current inherited environment, including
PATH, with any declared overrides applied on top. Command lookup therefore uses
the same environment as the child process.

Callers handle missing or unspawnable executables as ordinary non-zero results;
the runner does not turn them into an untyped rejection.
