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
| `subject` | Stable resource identity shared by progress, completed outcomes, and failures. |
| `integrity: { checksumUrl }` | Download and verify the installer checksum before execution. |
| `integrity: { acknowledgedUnverified: true }` | Explicitly records the reviewed unverified exception; no silent bypass exists. |
| `creates` | Default idempotency and post-install guard. A dangling symlink is absent. |
| `skipIf` | Command-health or version-aware idempotency and post-install guard when path existence is insufficient. |
| `upgrade` | Runs the declared self-update command for an already installed tool only under explicit upgrade intent. A fresh install does not run it again. |
| `upgrade.versionProbe` | Verifies local health before and after the update; a changed version reports changed, an equal version reports unchanged, and a failed post-update probe fails the activation. |
| `upgrade.blockedWhen` | Maps a known updater safety-precondition error to a blocked result with the upstream guidance. |
| `env` | Resolves literal, host, and declared values with the command-pipeline vocabulary. |
| `pathPrefix` | Prepends resolved host paths to the installer process PATH. |
| Temporary installer | Run with declared arguments, then remove the temporary workspace. |

Targets use remote installers only for reviewed first-party HTTPS sources.
The runner reports `check`, `install`, `update`, and `verify` activity only when
each operation actually begins. Upgrade intent alone never determines the
displayed operation because a missing or unhealthy installation still takes the
installer path under `--upgrade`.

## mev updates

`package.json` is the version authority embedded into every mev build. Published
tags are the same canonical semantic version prefixed by `v`, and release assets
remain immutable.

The updater resolves the latest tag, selects the existing darwin architecture
asset, and downloads its adjacent SHA256 document. Version ordering decides
whether to update, hold a locally newer command, or verify an equal version's
bytes. A replacement is staged beside the destination and must pass both digest
verification and its own `--version` probe before the atomic rename.

Standalone builds identify their executable through the running process; the
Bun-targeted development bundle identifies its entrypoint. Unbundled source
execution has no install destination and cannot update. After resolution or
replacement, the updater invokes the installed absolute path with `sync` and
forwards explicit upgrade intent. A failed update leaves the previous command
in place and does not sync; a failed sync leaves the verified updated command in
place for retry.
