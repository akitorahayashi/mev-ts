# Command Pipeline

`runCommand` is the activation kind for operations that require running host commands. Its key concepts:

- `reads` — asset keys whose trimmed content is bound into the scope before any step runs (e.g. `.ruby-version`). A read is a plain key rather than a callable form, so the declared intent hashes into the target signature; validation expressed as a function would be dropped from the hash and let a stale target pass `sync`.
- Scope — the named values a step resolves against at apply time: the reserved host facts `home` and `basePath` (the inherited `PATH`), the assets declared in `reads`, and the stdout of any prior `capture`. `ref(name)` throws `ProvisioningError` on a missing name so undefined arguments fail loudly.
- `steps` — ordered declarative data, resolved against the scope at apply time. Each step can declare:
  - `argv` — argument tokens, each a literal string, a `ref` (one scope value), a `splitRef` (a scope value split on whitespace), or a `concat` of tokens
  - `env` — environment overrides layered over the inherited environment; each value is a literal, a `ref`, a `concat`, or a `pathList` joined with `:`
  - `skipIf` — idempotency guard built from the same tokens: `{ pathExists }` or `{ commandSucceeds }`. `commandSucceeds` guards run with the step's `env` so toolchain shims are on PATH.
  - `capture` — register `stdout.trim()` into scope for later steps
  - `changedWhen` — `'always' | 'never' | { outputContains } | { outputNotContains }` — classify a successful run. `outputContains` and `outputNotContains` both match against combined stdout+stderr.

A failed step halts the pipeline. Skipped steps report `unchanged`. The overall status is `failed` if any step failed, `changed` if any step changed, otherwise `unchanged`.
