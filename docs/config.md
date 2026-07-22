# Config

`mev config` (alias `cf`) manages three independently selectable surfaces — coder AGENTS.md sections, coder skills, and Zed settings overrides — each resolved from a catalog against a stored selection manifest under `~/.mev/`. Command syntax for `config agents`, `config skills`, `config zed`, and `--clear` is in docs/usage.md. How the resulting `coderAgents`, `coderSkills`, and `zedSettings` activations apply the selection to the host is in docs/architecture.md.

## Selectable Surfaces

| Surface | Catalog source | Manifest path | Key | Polarity |
|---|---|---|---|---|
| AGENTS.md sections | `catalog.yml` listing order | `~/.mev/coder/agents-sections.yml` | `disabled` | opt-out |
| Skills | scan of the deployed skills directory | `~/.mev/coder/skills-selection.yml` | `disabled` | opt-out |
| Zed settings overrides | every `<name>.json` in the deployed `zed/overrides/` directory | `~/.mev/zed/overrides-selection.yml` | `enabled` | opt-in |

Skills and Zed overrides are purely filesystem-derived: a skill is any subdirectory of the deployed skills source, and an override is any `<name>.json` file in the deployed overrides directory, so neither needs a registration step. AGENTS.md sections are the exception — the catalog is `catalog.yml`'s listing, validated in both directions against the section files beside it: a listed name without a matching `<name>.md`, a `<name>.md` not listed, or a duplicate listing is a hard error rather than a silently reconciled catalog. Catalog order for sections is also concatenation order in the generated AGENTS.md.

## Selection Manifests

`resolveSelection(catalog, listed, mode)` (`config-selection/selection.ts`) splits a catalog into enabled and disabled names against the stored list. Under `opt-out`, the stored list names what's disabled, so catalog entries added by a later mev update stay enabled by default. Under `opt-in`, the stored list names what's enabled, so a newly added Zed override never starts applying itself to an existing `settings.json`. `app/config-selection.ts` drives the shared toggle flow (`configSelectManifest`/`configClearManifest`) over this resolver for all three surfaces.

A manifest is one YAML mapping with exactly one key holding a name list:

```yaml
disabled:
  - some-section-name
```

An absent manifest means an empty stored list, interpreted per polarity (all enabled under opt-out, none enabled under opt-in). A present manifest that is not a mapping, is missing its key, or whose list has non-string, empty, or duplicate names is rejected with a `ProvisioningError` rather than read as an empty selection — significant because an empty list means "everything enabled" under opt-out, so a mis-parse must never silently produce that. A name present in the manifest but absent from the catalog (for example, after an override file was deleted) is reported as a warning on stderr before the interactive prompt runs, never silently dropped.

`--clear` turns every entry off, but the operation differs by polarity: opt-out clear writes a snapshot of the current catalog as the disabled list, since deleting the manifest instead would leave it absent, which reads back as "everything enabled"; opt-in clear writes an empty enabled list, which is equivalent to deleting the manifest.

## Zed Settings Merge

`renderSettings` (`zed/settings.ts`) builds the deployed `settings.json` from the base settings asset plus the enabled overrides, in catalog order:

- `combineOverrides` (`zed/merge.ts`) deep-merges the enabled overrides into one fragment first, tracking which override name owns each JSON path. Two overrides setting the same leaf key throw a `ProvisioningError` naming both, rather than letting catalog order silently decide a winner — including the asymmetric case where one override sets an entire subtree as a primitive while another nests keys under that same path, in either declaration order.
- `deepMerge` then applies the combined overrides onto the base settings, with the overlay winning on every leaf it defines.
- Both reject `__proto__`, `constructor`, and `prototype` keys outright, since none are legitimate Zed setting names.

## Extending the Catalogs

A new Zed override is a `<name>.json` file dropped into `src/assets/config/zed/overrides/`; a new skill is a new skill subdirectory — neither needs a registration step. A new AGENTS.md section needs both the `<name>.md` file and a listing entry in `catalog.yml`; adding only one half fails loudly the next time the catalog is read.
