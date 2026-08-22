# Config

`mev config` (`cf`) manages selectable configuration surfaces and the per-machine
GitHub SSH host. Command syntax is in [usage.md](usage.md); activation contracts
are in [architecture/activation.md](architecture/activation.md).

## Selectable surfaces

| Surface | Catalog source | Manifest | Key | Polarity |
|---|---|---|---|---|
| AGENTS.md sections | `catalog.yml` order | `~/.mev/coder/agents-sections.yml` | `disabled` | Opt-out |
| Coder skills | Deployed skill directories | `~/.mev/coder/skills-selection.yml` | `disabled` | Opt-out |
| Zed overrides | Deployed `<name>.json` files | `~/.mev/zed/overrides-selection.yml` | `enabled` | Opt-in |

Skills and Zed overrides are filesystem-derived. AGENTS.md sections additionally
require a one-to-one match between catalog entries and sibling section files;
missing, extra, or duplicate entries fail.

## Selection manifests

Each manifest is one YAML mapping with one name-list key:

```yaml
disabled:
  - some-section-name
```

| Condition | Opt-out surface | Opt-in surface |
|---|---|---|
| Absent manifest | All catalog entries enabled | No entries enabled |
| Listed name | Disabled | Enabled |
| Invalid shape or name list | Reject with `ProvisioningError` | Reject with `ProvisioningError` |
| Name not in current catalog | Warn before the prompt | Warn before the prompt |
| `--clear` | Write the current catalog as disabled | Remove the manifest |

The resolver derives the stored key from the surface policy, so an opt-out list
cannot be interpreted as an opt-in list.

## Zed settings merge

The deployed `settings.json` is the base asset plus enabled overrides in catalog
order.

| Stage | Rule |
|---|---|
| Combine overrides | Deep-merge selected fragments; conflicting leaf paths fail with both owners. |
| Apply base | Override values win on every path they define. |
| Validate | Override fragments reject `__proto__`, `constructor`, and `prototype`. |

## GitHub SSH host

| State | Behavior |
|---|---|
| Store | `~/.mev/ssh-host`, one OpenSSH `Host` alias per line. |
| Valid value | Letters, digits, `.`, `_`, and `-`. |
| Absent store | Use `github.com`. |
| Malformed store | Fail; never silently fall back. |
| Affected provisioning | Grove renders the alias; agent-plugin registrations use it as transport. |

```text
github-personal
```

Saving the host invalidates the affected applied markers so the next `sync`
reconciles rendered URLs and marketplace registrations.

## Agent plugin catalog

The embedded catalog declares marketplaces and plugin names for Claude Code and
Codex. An entry declares the same marketplace for every client it lists. The
marketplace name defaults to the repository name; `name` is needed only when
the marketplace metadata uses a different name.

```yaml
marketplaces:
  - repo: akitorahayashi/agent-device-plugin
    clients: [claude, codex]
    plugins: [agent-device, diff-verify]
  - repo: akitorahayashi/xlsx
    clients: [claude, codex]
    plugins: [xlsx]
```

Removal is explicit:

```yaml
marketplaces:
  - repo: akitorahayashi/agent-device-plugin
    clients: [claude]
    plugins: [agent-device]
    uninstall: [diff-verify]

removed_marketplaces:
  - repo: akitorahayashi/comment-review
    clients: [claude]
```

Plugin lifecycle, source ownership, and verification are documented in
[architecture/agent-plugins.md](architecture/agent-plugins.md).

## Extending catalogs

| Surface | Add |
|---|---|
| Zed override | A `<name>.json` file under `src/assets/config/zed/overrides/`. |
| Skill | A skill subdirectory under the deployed skills source. |
| AGENTS.md section | A `<name>.md` file and one `catalog.yml` entry. |
