# Claude Code

## Skill locations

```tsv
path	scope
.claude/skills/<skill-name>/SKILL.md	The project containing it
~/.claude/skills/<skill-name>/SKILL.md	Every project
```

## Frontmatter fields

Claude Code reads these fields in `SKILL.md` frontmatter in addition to the common ones, and processes them itself, so they carry no instruction to the model.

```yaml
---
name: release-audit
description: Audits a release branch for unreleased migrations. Use when the user asks whether a branch is ready to release.
disable-model-invocation: true
user-invocable: true
model: opus
context: fork
agent: Explore
allowed-tools: Read, Grep, Bash(git log:*)
disallowed-tools: Write, Edit
---
```

```tsv
field	accepted values	effect
disable-model-invocation	true, false	true removes the skill from the Skill tool, leaving the user's `/release-audit`
user-invocable	true, false	false hides the slash command, leaving invocation through the Skill tool
model	haiku, sonnet, opus, fable, a full model ID, inherit	Model that runs the skill; inherit matches the parent conversation
context	inline, fork	inline expands the skill into the current conversation; fork runs it in a subagent
agent	An agent type such as Explore, Plan, general-purpose, or one defined under .claude/agents/	Agent type spawned by context: fork
allowed-tools	Comma-separated string or YAML list of tool patterns	Tools available while the skill is active
disallowed-tools	Comma-separated string or YAML list of tool patterns	Tools removed while the skill is active, until the user sends the next message
```
