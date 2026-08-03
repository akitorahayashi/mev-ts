---
name: plugin-guide
description: Creates and revises agent plugins and marketplaces for Claude Code, Codex, and ChatGPT.
---

# Agent Plugins

## Scope

An agent plugin is a self-contained distribution unit for reusable agent capabilities. It packages host-supported components such as skills, agents, hooks, MCP servers, connectors, executables, UI assets, and related configuration. This guide covers Claude Code plugins and OpenAI plugins for Codex and ChatGPT, not unrelated products that also use the term plugin.

## Choosing the Distribution Unit

Keep configuration standalone while it is project-specific, personal, or still being shaped. Use a plugin when the same capability needs installation, namespacing, versioning, updates, or reuse across projects or users.

A plugin has one coherent purpose. Each host-supported component contributes directly to that purpose:

- a skill carries a user- or model-invoked capability
- an agent carries isolated delegated work
- a hook reacts automatically to lifecycle or tool events
- an MCP server exposes an external service or tool protocol
- a connector exposes an authenticated external service through a supported host surface
- an LSP server supplies language intelligence
- `bin/` carries executables intentionally exposed to shell calls
- assets carry icons, screenshots, templates, or other material the host or bundled components need

Omit component types that do not improve the plugin's purpose. Packaging does not justify unrelated features.

## Required Context

Determine the plugin host, purpose, intended users, plugin root, required components, runtime dependencies, persistent state, installation scope, distribution source, and version strategy from the request and repository.

Existing `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.agents/plugins/marketplace.json`, component directories, and release conventions are authoritative local context. When the host, distribution, or version strategy remains materially ambiguous, obtain that decision before publishing configuration.

## Boundaries

- The plugin root owns every runtime file needed after installation.
- Host metadata directories contain plugin metadata; component directories remain at the plugin root.
- A marketplace catalogs and locates plugins. It does not become the plugin root unless its entry explicitly uses the marketplace root as the source.
- Component-specific behavior remains in the owning skill, agent, hook, or server definition. The plugin manifest does not duplicate those instructions.
- Cross-component workflow states each input, output, and caller boundary without making components depend on the original authoring conversation.

## Paths and State

Installed marketplace plugins may run from a copied or versioned cache rather than their source checkout. Runtime references use the path variables and cache rules of the selected host.

- Claude Code uses `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`, and `${CLAUDE_PROJECT_DIR}`.
- Codex hooks and plugin configuration use `${PLUGIN_ROOT}` for bundled plugin files and store installed plugins under the Codex plugin cache.

Runtime files do not use paths that escape the plugin root. Scripts resolve bundled files from the host's plugin-root variable, accept project paths explicitly, and do not assume the shell working directory. Writes target the host's documented persistent state location rather than immutable installed plugin files.

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
5. Add or revise the host-specific manifest for stable identity, metadata, custom paths, dependencies, options, or publication.
6. Replace checkout-relative paths with plugin runtime variables and separate immutable files from persistent state.
7. Add a marketplace entry only when installation or distribution requires a catalog.
8. Select explicit semantic versions for reviewed releases or commit-derived versions for continuous internal delivery.
9. Validate the package, exercise every component, and test installation through its intended distribution path.

## Validation

Use the selected host's validator or installation path. Claude Code provides an explicit validator:

```bash
claude plugin validate <plugin-root-or-marketplace-root> --strict
```

Load the source directly during development:

```bash
claude --plugin-dir <plugin-root>
```

For Codex and ChatGPT, test through the local marketplace flow or supported plugin browser because installation proves manifest discovery, marketplace source resolution, cache-relative paths, and enabled component behavior.

Plugin-specific scripts and servers run their own focused tests. A passing manifest validation does not prove their behavior.

## Reference

Read [Claude Code](references/claude-code.md) for Claude Code plugin layout, manifests, components, runtime paths, and caching.

Read [Codex](references/codex.md) for Codex and ChatGPT plugin layout, manifests, local marketplaces, runtime paths, MCP servers, and hooks.

Read [Claude Code Marketplace](references/marketplace.md) for Claude Code catalogs, source resolution, strict mode, versioning, installation, and distribution.
