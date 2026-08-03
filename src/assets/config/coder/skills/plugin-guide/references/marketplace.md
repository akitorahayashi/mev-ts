# Marketplace

## Authority

- [Create and distribute a plugin marketplace](https://code.claude.com/docs/en/plugin-marketplaces)
- [Discover and install plugins](https://code.claude.com/docs/en/discover-plugins)
- [Plugins reference](https://code.claude.com/docs/en/plugins-reference)

A marketplace is a catalog of installable plugins. Adding a marketplace registers the catalog; installing a plugin copies the selected plugin into Claude Code's cache.

## Root Separation

```text
<marketplace-root>/
├── .claude-plugin/
│   └── marketplace.json
└── plugin/
    └── <plugin-root>/
        ├── .claude-plugin/plugin.json
        ├── skills/
        └── agents/
```

Marketplace `source` paths resolve from the marketplace root, not from `.claude-plugin/`. Plugin manifest component paths resolve from the selected plugin root. These are separate path domains.

## Minimal Catalog

```json
{
  "name": "example-tools",
  "description": "Claude Code plugins maintained by the example team.",
  "owner": {
    "name": "Example Team"
  },
  "plugins": [
    {
      "name": "comment-review",
      "source": "./plugin/comment-review",
      "description": "Review pull requests and publish approved findings."
    }
  ]
}
```

The marketplace has a unique `name`, owner metadata, and a `plugins` array. Each plugin entry requires `name` and `source`. A relative source begins with `./`.

## Source Types

| source | use |
| --- | --- |
| relative path | plugin stored inside the marketplace repository |
| `github` | GitHub repository, optionally pinned by ref or full SHA |
| `url` | Git repository URL, optionally pinned by ref or full SHA |
| `git-subdir` | plugin contained in a subdirectory of a Git repository |
| `npm` | plugin distributed as an npm package and version |

The marketplace source locates `marketplace.json`. Each plugin entry's source independently locates that plugin. Trust and pinning decisions apply to both layers.

## Strict Mode

`strict` defaults to `true`.

| value | authority |
| --- | --- |
| `true` | the plugin's `plugin.json` owns its definition; the marketplace entry may supplement components |
| `false` | the marketplace entry is the complete definition and the plugin does not declare conflicting components |

Use the default for a self-owned plugin. Use `strict: false` only when a marketplace intentionally curates raw files and owns the complete exposed component set.

## Version Resolution

Claude Code resolves the installed version from the first available source:

1. `version` in the plugin's `plugin.json`
2. `version` in the marketplace plugin entry
3. the source Git commit SHA
4. `unknown` for sources without version or Git commit information

An explicit semantic version produces an update only after that value changes. It fits reviewed release cycles. Omitting explicit versions lets a Git commit identify each update and fits continuously delivered internal plugins.

Git sources follow the owning repository's trust policy. Immutable full commit SHAs provide reproducibility for third-party sources; reviewed release or major tags may be appropriate for trusted first-party sources when the repository explicitly permits moving references.

## Local Distribution Test

```text
claude plugin validate <marketplace-root> --strict
claude plugin marketplace add <marketplace-root>
claude plugin install <plugin-name>@<marketplace-name>
```

The test confirms:

- the catalog parses and identifies the intended plugin root
- source paths remain inside the copied distribution
- the plugin manifest and marketplace entry compose under the selected strict mode
- namespaced components appear after installation
- the installed cache copy can run bundled scripts and find bundled assets
- the selected version changes according to the release strategy

After the test, update the installed plugin through the same source and verify that the intended version is discoverable. A direct `--plugin-dir` test does not replace this installation test.

## Distribution Security

Marketplace and plugin sources are trusted code distribution channels. Catalog ownership, source origin, version pins, dependency installation, executable components, and requested credentials are reviewed before sharing the installation command.
