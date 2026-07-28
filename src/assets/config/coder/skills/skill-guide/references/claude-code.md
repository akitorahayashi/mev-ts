# Claude Code

Claude Code reads these settings from `SKILL.md` frontmatter and processes them itself, so they carry no instruction to the model. Common-specification fields it does not act on, such as `license` and `compatibility`, are ignored without error. Beyond the common-specification rules, it rejects a `name` containing the reserved word `anthropic` or `claude`.

## Skill locations

| path | scope |
| --- | --- |
| `.claude/skills/<skill-name>/SKILL.md` | The project containing it |
| `~/.claude/skills/<skill-name>/SKILL.md` | Every project |

## Who can invoke the skill

| intended callers | frontmatter |
| --- | --- |
| Model and user | Neither field |
| User only, by typing `/<skill-name>` | `disable-model-invocation: true` |
| Model only, through the Skill tool | `user-invocable: false` |

## Where the skill runs

| intent | frontmatter |
| --- | --- |
| Expand into the current conversation | Omit `context`, the default |
| Run in a subagent that reports back as a task notification | `context: fork` |
| Run in a subagent that blocks the turn until it returns | `context: fork` with `background: false` |
| Choose the subagent type | `agent: Explore`, or any agent type including entries under `.claude/agents/` |

`agent` and `background` apply only to `context: fork`.

## What the skill may use

| field | accepted values |
| --- | --- |
| `model` | `haiku`, `sonnet`, `opus`, `fable`, a full model ID, or `inherit` for the parent conversation's model |
| `effort` | `low`, `medium`, `high`, `xhigh`, or `max`, subject to model support |
| `allowed-tools` | Tool patterns as a comma-separated string or YAML list, such as `Read, Grep, Bash(git log:*)` |
| `disallowed-tools` | Same form as `allowed-tools`; the removal is cleared when the user sends the next message |

## When the skill loads, and how it appears

| field | accepted values | effect |
| --- | --- | --- |
| `when_to_use` | Free text | Appended to the skill's Skill tool description |
| `paths` | Glob patterns as a comma-separated string or YAML list | The skill loads only when the model touches a matching file |
| `hooks` | Same shape as `settings.json` hooks | Hooks registered while the skill is active |
| `argument-hint` | Free text | Placeholder shown after the slash command name |
| `shell` | `bash`, the default on every platform, or `powershell` | Shell for `!` command blocks |

## Example

```yaml
---
name: release-audit
description: Audits a release branch for unreleased migrations. Use when the user asks whether a branch is ready to release.
disable-model-invocation: true
context: fork
agent: Explore
model: opus
allowed-tools: Read, Grep, Bash(git log:*)
---
```
