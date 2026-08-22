# Release Binaries and Remote Installers

## Release binaries

| Declaration or state | Contract |
|---|---|
| Exact `tag` | Resolve only that tag; a matching installed version is unchanged. |
| `tag: latest` | Resolve the current release when the binary is missing or unverifiable, or when upgrade mode requests it. |
| Installed binary | Its reported version is the idempotency probe. A non-zero probe means unavailable or unverifiable and triggers a fetch. |
| Downloaded asset | Probe it before the atomic swap; a mismatched version leaves the previous binary in place. |
| Target signature | The declared tag is hashed; upgrade mode does not alter the signature. |

Release assets are first-party and are not digest-verified by this activation.
Changing a repository without changing the version-bearing declaration cannot be
detected by a version-only probe; changing the tag or removing the binary forces
resolution.

## Remote installers

| Declaration | Contract |
|---|---|
| `integrity: { checksumUrl }` | Download and verify the installer checksum before execution. |
| `integrity: { acknowledgedUnverified: true }` | Explicitly records the reviewed unverified exception; no silent bypass exists. |
| `creates` | Default idempotency guard for an installer path. |
| `skipIf` | Version-aware guard when the path exists for every version. |
| `upgrade` | Runs the declared self-update command for an already installed tool only under explicit upgrade intent. A fresh install does not run it again. A known safety-precondition error may be declared as blocked with its actionable upstream guidance. |
| `env` | Resolves literal, host, and declared values with the command-pipeline vocabulary. |
| `pathPrefix` | Prepends resolved host paths to the installer process PATH. |
| Temporary installer | Run with declared arguments, then remove the temporary workspace. |

Targets use remote installers only for reviewed first-party HTTPS sources.
