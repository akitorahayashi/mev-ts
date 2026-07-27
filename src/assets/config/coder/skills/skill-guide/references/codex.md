# Codex

## Skill locations

```tsv
path	scope
.agents/skills/<skill-name>/SKILL.md	The project containing it
~/.agents/skills/<skill-name>/SKILL.md	Every project
~/.codex/skills/<skill-name>/SKILL.md	Every project, Codex only
```

## agents/openai.yaml

Codex keeps its settings out of `SKILL.md`, in `agents/openai.yaml` inside the skill directory. Codex reads this file itself, so it carries no instruction to the model.

```text
<skill-name>/
├── SKILL.md
├── assets/
│   ├── icon-small.svg
│   └── icon-large.png
└── agents/
    └── openai.yaml
```

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

String values are quoted and keys are unquoted. Every section is optional, and `interface` is required once the file exists.

```tsv
field	accepted values	effect
interface.display_name	Human-facing title	Names the skill in skill lists and chips
interface.short_description	25–64 characters	Blurb shown for quick scanning
interface.icon_small	Path relative to the skill directory, kept under ./assets/	Small icon asset
interface.icon_large	Path relative to the skill directory, kept under ./assets/	Larger logo asset
interface.brand_color	#RRGGBB	Accent color for badges
interface.default_prompt	One sentence naming the skill as $<skill-name>	Prompt inserted when a user starts from the skill
dependencies.tools[].type	mcp	Dependency category; mcp is the only supported value
dependencies.tools[].value	MCP server identifier, such as github	Names the required server
dependencies.tools[].description	Human-readable explanation	States why the server is required
dependencies.tools[].transport	streamable_http, stdio	streamable_http reads url; stdio reads command
dependencies.tools[].url	MCP server URL	Endpoint of a streamable_http server
policy.allow_implicit_invocation	true, false	false keeps the skill out of the model context, leaving explicit $<skill-name> invocation. Defaults to true
```

Codex packages a skill for distribution only when `SKILL.md` leaves `disable-model-invocation` unset or false, so a skill restricted to explicit invocation carries `policy.allow_implicit_invocation: false` here rather than the Claude Code field.
