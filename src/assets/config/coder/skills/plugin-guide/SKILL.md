---
name: plugin-guide
description: Designs, packages, validates, versions, and distributes Claude Code plugins and plugin marketplaces. Use when the user asks about .claude-plugin/plugin.json, plugin components, plugin agents or skills, CLAUDE_PLUGIN_ROOT, local plugin testing, or marketplace.json.
---

# Claude Code Plugins

## Scope

A Claude Code plugin is a self-contained distribution unit for skills, agents, hooks, MCP servers, LSP servers, executables, and related configuration. This guide covers Claude Code plugins and marketplaces, not unrelated products that also use the term plugin.

## Choosing the Distribution Unit

Keep configuration standalone while it is project-specific, personal, or still being shaped. Use a plugin when the same capability needs installation, namespacing, versioning, updates, or reuse across projects or users.

A plugin has one coherent purpose. Each component contributes directly to that purpose:

- a skill carries a user- or model-invoked capability
- an agent carries isolated delegated work
- a hook reacts automatically to lifecycle or tool events
- an MCP server exposes an external service or tool protocol
- an LSP server supplies language intelligence
- `bin/` carries executables intentionally exposed to shell calls

Omit component types that do not improve the plugin's purpose. Packaging does not justify unrelated features.

## Required Context

Determine the plugin purpose, intended users, plugin root, required components, runtime dependencies, persistent state, installation scope, distribution source, and version strategy from the request and repository.

Existing `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, component directories, and release conventions are authoritative local context. When the distribution or version strategy remains materially ambiguous, obtain that decision before publishing configuration.

## Boundaries

- The plugin root owns every runtime file needed after installation.
- `.claude-plugin/` contains plugin metadata; component directories remain at the plugin root.
- A marketplace catalogs and locates plugins. It does not become the plugin root unless its entry explicitly uses the marketplace root as the source.
- Component-specific behavior remains in the owning skill, agent, hook, or server definition. The plugin manifest does not duplicate those instructions.
- Cross-component workflow states each input, output, and caller boundary without making components depend on the original authoring conversation.

## Paths and State

Installed marketplace plugins run from a versioned cache rather than their source checkout.

- `${CLAUDE_PLUGIN_ROOT}` addresses immutable files bundled with the installed plugin.
- `${CLAUDE_PLUGIN_DATA}` addresses generated state, installed dependencies, and caches that survive updates.
- `${CLAUDE_PROJECT_DIR}` addresses files owned by the active project.

Runtime files do not use paths that escape the plugin root. Scripts resolve bundled files from `${CLAUDE_PLUGIN_ROOT}`, accept project paths explicitly, and do not assume the shell working directory. Writes do not target `${CLAUDE_PLUGIN_ROOT}` because an update changes that location.

## Security

Plugins are trusted code that can execute with the user's operating-system privileges.

- Hooks, MCP servers, LSP servers, and executables receive only the authority needed by the plugin purpose.
- Install-time and first-run network or package operations are explicit, reviewable, and fail visibly.
- Secrets remain in host credential stores or environment configuration, not plugin files, logs, or marketplace metadata.
- Persistent data has an ownership and cleanup policy.
- User-provided paths and plugin options are validated before reaching commands.
- Third-party sources follow the repository's supply-chain pinning policy.

## Authoring Workflow

1. Decide whether standalone configuration or a distributable plugin owns the capability.
2. Establish the plugin root separately from any repository or marketplace root.
3. Select only the component types required by the purpose.
4. Define each component with its own responsibility and boundary contract.
5. Add a manifest when stable identity, metadata, custom paths, dependencies, options, or publication require it.
6. Replace checkout-relative paths with plugin runtime variables and separate immutable files from persistent state.
7. Add a marketplace entry only when installation or distribution requires a catalog.
8. Select explicit semantic versions for reviewed releases or commit-derived versions for continuous internal delivery.
9. Validate the package, exercise every component, and test installation through its intended distribution path.

## Validation

Run the official validator with warnings treated as failures:

```bash
claude plugin validate <plugin-root-or-marketplace-root> --strict
```

Load the source directly during development:

```bash
claude --plugin-dir <plugin-root>
```

Test component behavior individually, run `/reload-plugins` after plugin component changes, and install from a local marketplace before release. The installed test verifies cache-relative paths, namespacing, manifest discovery, and marketplace source resolution that direct source loading cannot prove.

Plugin-specific scripts and servers run their own focused tests. A passing manifest validation does not prove their behavior.

## Reference

Read [Claude Code](references/claude-code.md) for plugin layout, manifests, components, runtime paths, and caching.

Read [Marketplace](references/marketplace.md) for catalogs, source resolution, strict mode, versioning, installation, and distribution.
