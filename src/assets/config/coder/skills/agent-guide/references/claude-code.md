# Claude Code

## Authority

- [Create custom subagents](https://code.claude.com/docs/en/sub-agents)
- [Plugins reference](https://code.claude.com/docs/en/plugins-reference)

Claude Code subagents are Markdown files with YAML frontmatter followed by the agent's system prompt.

## Scopes and Precedence

Claude Code resolves same-named definitions in this order:

| priority | source | scope |
| --- | --- | --- |
| 1 | managed settings agents | organization |
| 2 | `--agents` JSON | current session |
| 3 | `.claude/agents/` | project |
| 4 | `~/.claude/agents/` | user |
| 5 | `<plugin-root>/agents/` | enabled plugin |

Project and user agent directories are scanned recursively. A subdirectory does not change a standalone agent's identity; frontmatter `name` is authoritative. A plugin subdirectory contributes to the plugin-scoped identifier, such as `my-plugin:review:security`.

## File Format

```markdown
---
name: code-reviewer
description: Reviews a completed code change for correctness and missing tests. Use after implementation and before integration.
tools: Read, Grep, Glob, Bash
model: inherit
---

Review the delegated change. Return findings ordered by severity with file references and evidence. Do not modify files.
```

Only `name` and `description` are required. `name` uses lowercase letters and hyphens and does not contain `:`, which is reserved for plugin scoping. `description` is routing metadata and states when delegation is appropriate. The Markdown body is the agent's system prompt.

## Frontmatter

| field | effect |
| --- | --- |
| `name` | agent identity |
| `description` | delegation routing |
| `tools` | allowed tool set; omission inherits the tools available to subagents |
| `disallowedTools` | tools removed from the inherited or declared set |
| `model` | model alias, full model identifier, or `inherit` |
| `effort` | reasoning effort supported by the selected model |
| `permissionMode` | permission behavior for a standalone agent |
| `maxTurns` | maximum agentic turns |
| `skills` | skills whose full contents are preloaded at startup |
| `mcpServers` | configured server names or inline server definitions |
| `hooks` | lifecycle hooks active only for this agent |
| `memory` | persistent memory at `user`, `project`, or `local` scope |
| `background` | forces background execution when true |
| `isolation` | `worktree` for an isolated Git worktree |
| `color` | display color in agent UI surfaces |

Preloading `skills` injects their contents but does not prevent discovery of other skills. Remove the `Skill` tool when the agent must not invoke skills.

## Plugin Agents

Plugin agents support `name`, `description`, `model`, `effort`, `maxTurns`, `tools`, `disallowedTools`, `skills`, `memory`, `background`, and `isolation`. Claude Code ignores `permissionMode`, `mcpServers`, and `hooks` in plugin-shipped agent frontmatter. Session-level settings own those capabilities for plugin agents.

Plugin agents are invoked under a scoped name such as `comment-review:pr-reviewer`. The scope prevents collisions with standalone and other plugin agents.

## Startup Context

A normal subagent starts with a fresh context. It receives:

- its system prompt and basic environment details
- the delegation task message
- applicable `CLAUDE.md` files, except for built-in Explore and Plan agents
- a Git status snapshot when available
- the full contents of preloaded skills

It does not inherit the parent's conversation history, files already read, invoked skills, or output style. A conversation fork is the distinct mechanism that inherits parent context.

## Invocation and Continuation

Natural-language delegation lets Claude decide whether to invoke the named agent. An agent `@` mention guarantees a particular agent for one task. `claude --agent <name>` runs the main session under that definition.

Completed resumable agents retain their task history when continued through the agent messaging mechanism. A follow-up message cannot change permissions or count as user approval.

## Verification

- Invoke the agent with a representative task and inspect the agent thread rather than inferring invocation from the prose response.
- Confirm that unavailable tools fail and that allowed tools cover the declared job.
- Confirm the result follows the output contract and contains no undeclared file writes.
- Run `/doctor` when duplicate definitions or discovery are in question.
- For plugin agents, run `claude plugin validate <plugin-root> --strict`, load with `claude --plugin-dir <plugin-root>`, and use `/reload-plugins` after definition changes.
