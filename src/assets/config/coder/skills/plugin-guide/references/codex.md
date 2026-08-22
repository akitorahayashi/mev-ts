# Codex and ChatGPT

## Authority

- [Plugins](https://developers.openai.com/codex/plugins)
- [Skills and plugins](https://developers.openai.com/codex/skills-and-plugins)
- [Package your plugin](https://developers.openai.com/plugins/build/plugins)
- [Build skills](https://developers.openai.com/codex/build-skills)

OpenAI plugins are installable bundles shared by supported ChatGPT and Codex surfaces. They can include skills, connectors, MCP servers, hooks, scheduled task templates, browser extensions, and assets. Codex CLI supports browsing and installing plugins from configured marketplaces; installed bundled skills and tools are available in new sessions.

## Standard Layout

```text
<plugin-root>/
├── .codex-plugin/
│   └── plugin.json
├── skills/
│   └── <skill>/SKILL.md
├── hooks/
│   └── hooks.json
├── .app.json
├── .mcp.json
└── assets/
```

Every OpenAI plugin has `.codex-plugin/plugin.json`. Only `plugin.json` belongs in `.codex-plugin/`. Skills, hooks, assets, `.mcp.json`, and `.app.json` remain at the plugin root.

## Components

| component | default location | behavior |
| --- | --- | --- |
| skills | `skills/<name>/SKILL.md` | reusable workflows loaded by ChatGPT or Codex |
| hooks | `hooks/hooks.json` | lifecycle hooks loaded when the plugin is enabled and trusted |
| MCP servers | `.mcp.json` | bundled server configuration for tools and context |
| app mappings | `.app.json` | registered MCP server connections used by connector-style plugins |
| assets | `assets/` | icons, logos, screenshots, and presentation materials |

Connectors are backed by MCP servers and may include custom UI on supported ChatGPT surfaces. Codex can use bundled skills and MCP tools where the active surface supports plugins.

OpenAI plugins do not package Claude `agents/*.md` or Codex custom-agent TOML. Codex custom agents and multi-agent tools come from host and project configuration independently of the plugin. A bundled shared skill treats delegation as an optional host capability and states equivalent main-session behavior when it is unavailable.

## Manifest

`<plugin-root>/.codex-plugin/plugin.json` identifies the plugin, points to bundled components, and supplies install-surface metadata.

```json
{
  "name": "my-plugin",
  "version": "0.1.0",
  "description": "Bundle reusable skills and MCP servers.",
  "skills": "./skills/",
  "mcpServers": "./.mcp.json",
  "hooks": "./hooks/hooks.json",
  "apps": "./.app.json",
  "interface": {
    "displayName": "My Plugin",
    "shortDescription": "Reusable skills and MCP servers",
    "category": "Productivity",
    "composerIcon": "./assets/icon.png"
  }
}
```

`name`, `version`, and `description` identify the plugin. `author`, `homepage`, `repository`, `license`, and `keywords` provide publisher and discovery metadata. `skills`, `mcpServers`, `hooks`, and `apps` point to bundled components. `interface` controls display metadata such as `displayName`, descriptions, category, default prompts, icons, logos, and screenshots.

## Path Rules

Manifest paths are relative to the plugin root and start with `./`. Store visual assets under `./assets/` when possible. Use `skills` for bundled skill folders, `mcpServers` for `.mcp.json`, `hooks` for lifecycle hooks, and `apps` for registered MCP server mappings in `.app.json`.

Bundled skills refer to their own supporting files with Markdown links relative to the skill directory. They do not use plugin-root variables or a skill-directory placeholder for those files.

Codex plugin hooks receive `${PLUGIN_ROOT}` for bundled files and `${PLUGIN_DATA}` for writable persistent state. Hook commands quote substituted paths when using shell forms.

For a bundled stdio MCP server, set `cwd` to a path relative to the plugin root, such as `"."`, and keep bundled command arguments relative to that working directory. Codex resolves a relative MCP `cwd` against the installed plugin root. MCP `command` and `args` fields do not expand `${PLUGIN_ROOT}` or `${PLUGIN_DATA}`.

## Local Marketplace

Repo marketplaces live at `$REPO_ROOT/.agents/plugins/marketplace.json`. Personal marketplaces live at `~/.agents/plugins/marketplace.json`. ChatGPT also reads a legacy-compatible repo marketplace at `$REPO_ROOT/.claude-plugin/marketplace.json`.

```json
{
  "name": "local-repo",
  "interface": {
    "displayName": "Local Repo Plugins"
  },
  "plugins": [
    {
      "name": "my-plugin",
      "source": {
        "source": "local",
        "path": "./plugins/my-plugin"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Productivity"
    }
  ]
}
```

`source.path` resolves relative to the marketplace root, not relative to `.agents/plugins/`. Keep local paths inside that marketplace root. Local sources can also use a plain string such as `"./plugins/my-plugin"`.

Codex CLI manages marketplace sources with:

```bash
codex plugin marketplace add <source>
codex plugin marketplace list
codex plugin marketplace upgrade
codex plugin marketplace remove <marketplace-name>
```

Marketplace sources can be local directories, GitHub shorthand, HTTP or HTTPS Git URLs, SSH Git URLs, or Git sparse checkouts.

## Source Types

| source | use |
| --- | --- |
| `local` | plugin stored under a local marketplace root |
| `url` | plugin stored at a Git repository root |
| `git-subdir` | plugin stored in a Git repository subdirectory |
| `npm` | plugin distributed as a package from a JavaScript registry |

Git-backed entries use `ref` or `sha` selectors. NPM entries use `package`, optional `version`, and optional HTTPS `registry`; Codex downloads the package without running lifecycle scripts.

## Installation and Cache

ChatGPT installs marketplace plugins into `~/.codex/plugins/cache/$MARKETPLACE_NAME/$PLUGIN_NAME/$VERSION/`. For local plugins, `$VERSION` is `local`. ChatGPT loads the installed copy from the cache path rather than directly from the marketplace entry.

Plugin enabled state is stored in `~/.codex/config.toml`. After installing or enabling a plugin, start a new Codex session before expecting bundled skills or tools to be available.

## MCP Servers and Hooks

`mcpServers` points to an `.mcp.json` file containing either a direct server map or a wrapped `mcp_servers` object. Users can enable or disable bundled MCP servers and tune plugin-scoped MCP tool approval policy under `plugins.<plugin>.mcp_servers.<server>` in Codex config.

Plugin hooks are non-managed hooks. Installing or enabling a plugin does not automatically trust its hooks; Codex skips them until the user reviews and trusts the current hook definition. If `hooks` is omitted from the manifest, Codex checks the default `hooks/hooks.json`.

## Development Verification

1. Install through a repo or personal marketplace.
2. Restart the ChatGPT desktop app or start a new Codex CLI session.
3. Verify the plugin appears in the supported plugin browser or marketplace list.
4. Invoke each bundled skill and verify MCP tools or hooks in a controlled environment.
5. Update the marketplace source and repeat installation or upgrade to verify the intended version and cached layout.
