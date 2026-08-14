# Config

`mev config` (alias `cf`) manages three independently selectable surfaces — coder AGENTS.md sections, coder skills, and Zed settings overrides — plus the per-machine SSH host used for GitHub access. The selectable surfaces resolve a catalog against a stored selection manifest under `~/.mev/`. Command syntax is in docs/usage.md; activation behavior is in docs/architecture/activation.md.

## Selectable Surfaces

| Surface | Catalog source | Manifest path | Key | Polarity |
|---|---|---|---|---|
| AGENTS.md sections | `catalog.yml` listing order | `~/.mev/coder/agents-sections.yml` | `disabled` | opt-out |
| Skills | scan of the deployed skills directory | `~/.mev/coder/skills-selection.yml` | `disabled` | opt-out |
| Zed settings overrides | every `<name>.json` in the deployed `zed/overrides/` directory | `~/.mev/zed/overrides-selection.yml` | `enabled` | opt-in |

Skills and Zed overrides are purely filesystem-derived: a skill is any subdirectory of the deployed skills source, and an override is any `<name>.json` file in the deployed overrides directory, so neither needs a registration step. AGENTS.md sections are the exception — the catalog is `catalog.yml`'s listing, validated in both directions against the section files beside it: a listed name without a matching `<name>.md`, a `<name>.md` not listed, or a duplicate listing is a hard error rather than a silently reconciled catalog. Catalog order for sections is also concatenation order in the generated AGENTS.md.

## Selection Manifests

`resolveSelection(catalog, listed, mode)` (`config-selection/selection.ts`) splits a catalog into enabled and disabled names against the stored list. Under `opt-out`, the stored list names what's disabled, so catalog entries added by a later mev update stay enabled by default. Under `opt-in`, the stored list names what's enabled, so a newly added Zed override never starts applying itself to an existing `settings.json`. `app/config-toggle.ts` drives the shared toggle flow (`configSelectManifest`/`configClearManifest`) over this resolver for all three surfaces.

A surface's polarity reaches its call sites as a `SelectionPolicy` (`selectionPolicy(mode, label)`), not as a mode argument passed alongside a name list: `coder/manifest.ts` exports `catalogSelection` and `zed/manifest.ts` exports `overrideSelection`, each binding the mode to the manifest key it stores under and to the read, write, and resolve operations. The key is derived from the mode, so a manifest listing `disabled` names can never be resolved as `enabled` — an inversion that would silently reverse every entry's meaning.

A manifest is one YAML mapping with exactly one key holding a name list:

```yaml
disabled:
  - some-section-name
```

An absent manifest means an empty stored list, interpreted per polarity (all enabled under opt-out, none enabled under opt-in). A present manifest that is not a mapping, is missing its key, or whose list has non-string, empty, or duplicate names is rejected with a `ProvisioningError` rather than read as an empty selection — significant because an empty list means "everything enabled" under opt-out, so a mis-parse must never silently produce that. A name present in the manifest but absent from the catalog (for example, after an override file was deleted) is reported as a warning on stderr before the interactive prompt runs, never silently dropped.

`--clear` turns every entry off, but the operation differs by polarity: opt-out clear writes a snapshot of the current catalog as the disabled list, since deleting the manifest instead would leave it absent, which reads back as "everything enabled"; opt-in clear removes the manifest outright (`writeNameList` unlinks rather than writing an empty list), since an absent manifest already means no overrides are enabled.

## Zed Settings Merge

`zed/settings.ts` builds the deployed `settings.json` from the base settings asset plus the enabled overrides, in catalog order:

- `combineOverrides` (`zed/merge.ts`) deep-merges the enabled overrides into one fragment first, tracking which override name owns each JSON path. Two overrides setting the same leaf key throw a `ProvisioningError` naming both, rather than letting catalog order silently decide a winner — including the asymmetric case where one override sets an entire subtree as a primitive while another nests keys under that same path, in either declaration order.
- `deepMerge` then applies the combined overrides onto the base settings, with the overlay winning on every leaf it defines.
- Override fragments reject `__proto__`, `constructor`, and `prototype` keys outright, since none are legitimate Zed setting names. This check runs over override data only; the base settings asset is not separately validated for these keys.

## GitHub SSH Host

Every GitHub connection over SSH resolves its host alias from one per-machine store at `~/.mev/ssh-host`, a plain text file holding the alias on its own line:

```text
github-personal
```

The value is an OpenSSH `Host` alias and accepts letters, digits, `.`, `_`, and `-`; SSH configuration owns its real hostname, port, key, and authentication. An absent store means the stock `github.com` host. A malformed present file fails rather than reverting to the default. Grove provisioning renders stock `git@github.com:` repository URLs in its embedded catalog through this alias before placing `~/Desktop/grove.toml`; HTTPS and already-aliased URLs remain unchanged. Agent plugin marketplaces register through the same alias, and their registrations persist it inside each client's config. Saving an SSH host invalidates the applied markers of Grove and the coder target, so the next `sync` selects them: Grove renders the new alias and drifted marketplace registrations are re-registered under it.

## Agent Plugin Catalog

The embedded catalog lists the marketplaces and plugin names for Claude Code and Codex. A name under `plugins` means the plugin is installed and enabled — presence alone does not satisfy it, so a plugin disabled through a client's own interface is re-enabled by the next run, and turning one off is spelled by moving its name into the entry's `uninstall` list. Each entry names its GitHub repository in `owner/name` form; the registered marketplace name defaults to the repo name and is declared as `name` only when the repository's marketplace.json diverges from it:

```yaml
marketplaces:
  - client: claude
    repo: akitorahayashi/agent-device-plugin
    plugins: [agent-device, diff-verify]
```

The catalog also declares removals explicitly, through two optional lists that are absent while there is nothing to remove. Moving a plugin name out of a marketplace's `plugins` into an `uninstall` list on the same entry uninstalls it:

```yaml
marketplaces:
  - client: claude
    repo: akitorahayashi/agent-device-plugin
    plugins: [agent-device]
    uninstall: [diff-verify]
```

Deleting a whole marketplace entry and moving its `client` and `repo` lines under a root `removed_marketplaces` list uninstalls the plugins it still has installed, then deregisters the marketplace:

```yaml
removed_marketplaces:
  - client: claude
    repo: akitorahayashi/comment-review
```

Only listed items are removed, and a removal dismantles only the marketplace the tombstone's repository actually registered: a same-named marketplace from another source refuses removal, and plugins installed by hand outside the catalog are never touched. Because the catalog is an embedded asset, these edits mark the coder target stale and `mev sync` converges them.

## Extending the Catalogs

A new Zed override is a `<name>.json` file dropped into `src/assets/config/zed/overrides/`; a new skill is a new skill subdirectory — neither needs a registration step. A new AGENTS.md section needs both the `<name>.md` file and a listing entry in `catalog.yml`; adding only one half fails loudly the next time the catalog is read.
