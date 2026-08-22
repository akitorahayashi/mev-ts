# Claude Code

## Authority

- [Create plugins](https://code.claude.com/docs/en/plugins)
- [Plugins reference](https://code.claude.com/docs/en/plugins-reference)
- [Discover and install plugins](https://code.claude.com/docs/en/discover-plugins)

## Standard Layout

```text
<plugin-root>/
├── .claude-plugin/
│   └── plugin.json
├── skills/
│   └── <skill>/SKILL.md
├── agents/
│   └── <agent>.md
├── hooks/
│   └── hooks.json
├── output-styles/
├── bin/
├── scripts/
├── settings.json
├── .mcp.json
└── .lsp.json
```

The manifest is optional. When it is absent, Claude Code derives the plugin name from the directory and discovers components at default locations. A distributed plugin normally includes a manifest for stable identity and metadata.

Only `plugin.json` belongs inside `.claude-plugin/`. Skills, agents, hooks, scripts, servers, executables, and configuration remain at the plugin root. A plugin-root `CLAUDE.md` is not loaded as project context.

## Components

| component | default location | behavior |
| --- | --- | --- |
| skills | `skills/<name>/SKILL.md` | user- or model-invoked capabilities with supporting files |
| commands | `commands/*.md` | legacy flat skills; new plugins use `skills/` |
| agents | `agents/*.md` | specialized delegated subagents |
| hooks | `hooks/hooks.json` | event-triggered behavior |
| MCP servers | `.mcp.json` | external tool and service connections |
| LSP servers | `.lsp.json` | language-server configuration |
| output styles | `output-styles/*.md` | response presentation definitions |
| executables | `bin/` | commands added to the Bash tool's `PATH` while enabled |
| settings | `settings.json` | supported plugin defaults such as the active agent |

Experimental components remain isolated from a plugin's required capability because their schemas may change.

Plugin skills and agents appear under a plugin namespace such as `/comment-review:review-pr` and `comment-review:pr-reviewer`.

## Manifest

`<plugin-root>/.claude-plugin/plugin.json` is JSON. If present, `name` is the only required field.

```json
{
  "name": "comment-review",
  "version": "1.0.0",
  "description": "Review pull requests and publish approved findings.",
  "author": {
    "name": "Example Author"
  },
  "repository": "https://github.com/example/comment-review",
  "keywords": ["review", "github"]
}
```

`name` is a kebab-case identifier and owns component namespacing. `displayName`, `version`, `description`, `author`, `homepage`, `repository`, `license`, and `keywords` are metadata. The optional `$schema` field enables editor validation but does not replace the Claude CLI validator.

`dependencies` declares plugin dependencies. Each entry is either a plugin name string or an object with `name`, optional `version`, and optional `marketplace`. A name-only dependency resolves from the same marketplace by default and is installed with the depending plugin. Use `version` only when the depending plugin intentionally requires a specific released dependency version.

Custom component locations use `skills`, `commands`, `agents`, `hooks`, `mcpServers`, `lspServers`, and `outputStyles`. Paths are relative to the plugin root, begin with `./`, and may be arrays where supported. Once a manifest field defines a component's paths, the manifest owns discovery for that component; default and custom layouts are not mixed implicitly.

Use default locations unless a custom layout removes real complexity.

## Runtime Paths

| variable | ownership |
| --- | --- |
| `${CLAUDE_PLUGIN_ROOT}` | files bundled in the installed plugin version |
| `${CLAUDE_PLUGIN_DATA}` | persistent generated files, dependencies, and caches |
| `${CLAUDE_PROJECT_DIR}` | active project files |

Skill and agent content can substitute these variables. Hook commands and MCP or LSP configuration support substitution in their documented command, argument, environment, URL, header, or workspace fields.

A skill shared with other hosts uses skill-relative Markdown links for its own supporting files. `${CLAUDE_PLUGIN_ROOT}` remains for Claude-specific content and plugin-root files outside the skill directory.

Prefer argument-array or exec forms where supported. Shell-form commands quote substituted paths.

## Cache Behavior

Marketplace installation copies each plugin version into `~/.claude/plugins/cache`. The source checkout is not the runtime location.

- References that traverse outside the plugin root fail after installation.
- Plugin code and bundled configuration remain immutable at runtime.
- Persistent state uses `${CLAUDE_PLUGIN_DATA}` because the versioned root changes on update.
- A dependency cache compares its bundled dependency manifest with the persistent copy so plugin updates can trigger a reviewed reinstall.
- A mid-session update requires `/reload-plugins` for hooks and server connections to adopt the new version; some long-lived components require a new session.

## Plugin-Agent Restrictions

Plugin-shipped agents do not receive agent-local `permissionMode`, `mcpServers`, or `hooks`. Claude Code ignores those frontmatter fields for security. Session or plugin-level configuration owns these capabilities.

## Development Verification

1. Run `claude plugin validate <plugin-root> --strict`.
2. Load with `claude --plugin-dir <plugin-root>`.
3. Invoke every skill and agent by its plugin-scoped name.
4. Trigger hooks and connect each MCP or LSP server in a controlled environment.
5. Run `/reload-plugins` after non-skill component changes.
6. Install through a local marketplace and repeat a representative invocation from the cached copy.

Only trusted plugin sources are installed. A plugin may execute arbitrary commands with the user's privileges.
