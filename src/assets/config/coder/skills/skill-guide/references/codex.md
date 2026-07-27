# Codex

Codex keeps its settings out of `SKILL.md`, in `agents/openai.yaml` inside the skill directory, and reads that file itself, so it carries no instruction to the model. The file has three sections — `interface`, `policy`, and `dependencies` — with quoted string values and unquoted keys.

## Skill locations

```tsv
path	scope
.agents/skills/<skill-name>/SKILL.md	The project containing it
~/.agents/skills/<skill-name>/SKILL.md	Every project
~/.codex/skills/<skill-name>/SKILL.md	Every project, Codex only
```

## Who can invoke the skill

```tsv
intended callers	agents/openai.yaml
Model and user	policy.allow_implicit_invocation: true, the default
User only, by typing $<skill-name>	policy.allow_implicit_invocation: false
```

Codex packages a skill for distribution only when `SKILL.md` leaves `disable-model-invocation` unset or false, so a skill restricted to explicit invocation declares it here rather than with the Claude Code field.

## How the skill appears

```tsv
field	accepted values
interface.display_name	Title shown in skill lists and chips
interface.short_description	25–64 characters, for quick scanning
interface.icon_small	Path relative to the skill directory, kept under ./assets/
interface.icon_large	Path relative to the skill directory, kept under ./assets/
interface.brand_color	#RRGGBB
interface.default_prompt	One sentence naming the skill as $<skill-name>, inserted when a user starts from the skill
```

## What the skill requires

```tsv
field	accepted values
dependencies.tools[].type	mcp, the only supported category
dependencies.tools[].value	Server identifier, such as github
dependencies.tools[].description	Reason the server is required
dependencies.tools[].transport	streamable_http, which reads url; stdio, which reads command
dependencies.tools[].url	Endpoint of a streamable_http server
dependencies.tools[].command	Launch command of a stdio server
```

## Example

```yaml
interface:
  display_name: "Release Audit"
  short_description: "Check a release branch for unreleased migrations"
  icon_small: "./assets/icon-small.svg"
  icon_large: "./assets/icon-large.png"
  brand_color: "#3B82F6"
  default_prompt: "Use $release-audit to check whether the current branch is ready to release."

dependencies:
  tools:
    - type: "mcp"
      value: "github"
      description: "GitHub MCP server"
      transport: "streamable_http"
      url: "https://api.githubcopilot.com/mcp/"

policy:
  allow_implicit_invocation: false
```
