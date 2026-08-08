# Asset Embedding (assets/)

Raw config files live under `src/assets/config/` keyed as `{role}/{filename}`. `scripts/generate-assets.ts` walks the tree and inlines every file's content as a string, emitting `assets/registry.generated.ts`. The content is embedded in the compiled binary; no per-file imports or filesystem access occur at runtime. The generated file also embeds a `registrySourceHash` over the source tree; `scripts/validate-assets.ts` recomputes that hash and fails loudly when the committed registry is stale, so drift surfaces as an explicit error rather than confusing downstream failures.

`assets/registry.ts` wraps the generated map as `AssetSource`. An unknown key throws `ProvisioningError`. `keysByPrefix` lets targets derive their file lists from the embedded set rather than enumerating them by hand.

`AssetRef` keys double as sub-paths under the deploy root (`~/.mev/roles/`), so the deployed filename preserves the original dotfile name without a separate mapping.

## Deploy Store Layout

All deployed assets land at `~/.mev/roles/{key}`. The constant `deployRoot = '${mevRoot}/roles'` (built from `mevRoot = '.mev'` in `host/path.ts`, the sole authority for the mev-managed root) in `assets/ref.ts` is the sole authority for this path. Symlinks created by `file` and `tree` activations point into this store, and declared symlink destinations are reconciled from the current repository config.
