# Asset Embedding

The asset directory is the source of truth for deployable configuration.

| Boundary | Contract |
|---|---|
| Source | Files under `src/assets/config/{role}/`. |
| Code generation | `scripts/generate-assets.ts` embeds content and a source-tree hash in `registry.generated.ts`. |
| Runtime | `AssetSource` reads the generated map; an unknown key fails with `ProvisioningError`. |
| Target declarations | `keysByPrefix` derives asset sets from the embedded registry. |
| Deploy store | `AssetRef.key` is also the relative path under `~/.mev/roles/`. |

## Deploy store

All deployed assets live under `~/.mev/roles/{key}`. `file` and `tree`
activations link into that store; generated and managed paths derive from the
single `mevRoot` authority in `host/path.ts`.
