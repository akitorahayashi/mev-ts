# Codex

## Authority

- [Subagents](https://developers.openai.com/codex/multi-agent)
- [Configuration reference](https://developers.openai.com/codex/config-reference)

Codex custom agents are standalone TOML configuration layers for spawned sessions.

## Locations

| path | scope |
| --- | --- |
| `.codex/agents/<agent>.toml` | current project |
| `~/.codex/agents/<agent>.toml` | user |

Each file defines one agent. The `name` field is authoritative; matching the filename to it is the clearest convention.

## Required Fields

```toml
name = "code_mapper"
description = "Read-only codebase explorer for locating the execution path relevant to a delegated task."
sandbox_mode = "read-only"
developer_instructions = """
Trace the real execution path and return concise evidence with file references.
Do not edit files or propose changes outside the delegated scope.
"""
```

| field | purpose |
| --- | --- |
| `name` | identity used when spawning or referring to the agent |
| `description` | human-facing guidance for when Codex uses the agent |
| `developer_instructions` | invariant behavior for the spawned session |

The file may contain other supported Codex configuration keys, including `model`, `model_reasoning_effort`, `sandbox_mode`, `mcp_servers`, and `skills.config`.

## Inheritance

When the custom file defines `model` or `model_reasoning_effort`, that value takes precedence. Otherwise Codex resolves each value from an explicit spawn setting, the corresponding `[agents]` default, and then the parent session.

Other omitted session settings inherit from the parent. Live runtime permission and sandbox choices made for the parent turn remain an outer boundary and are reapplied when Codex spawns a child.

An agent that needs less authority declares a narrower `sandbox_mode`. An agent definition does not rely on a broader sandbox than the active parent permits.

## Global Subagent Settings

Global and project Codex configuration can set:

```toml
[agents]
enabled = true
max_concurrent_threads_per_session = 4
default_subagent_model = "<model-id>"
default_subagent_reasoning_effort = "medium"
interrupt_message = true
```

| field | effect |
| --- | --- |
| `enabled` | enables or disables multi-agent tools |
| `max_concurrent_threads_per_session` | caps concurrently open spawned-agent threads |
| `default_subagent_model` | default child model when no more specific setting exists |
| `default_subagent_reasoning_effort` | default child reasoning effort |
| `interrupt_message` | records or omits a model-visible interruption message |

Codex includes general-purpose `default`, implementation-focused `worker`, and read-heavy `explorer` agents. A custom definition is justified when those roles do not express the required responsibility or configuration.

## Delegation

Codex delegates after a direct request or applicable project or skill instruction. A delegation prompt states the division of work, independence assumptions, whether all agents must finish before synthesis, and the result format.

Read-heavy exploration, test execution, log analysis, and independent review dimensions are suitable parallel work. Concurrent edits to shared files are not.

## Verification

- Ask Codex to spawn the agent by its declared name and inspect the resulting agent thread.
- Use a task that exercises the declared sandbox, MCP, or skill configuration.
- Confirm the result follows the declared output and that the parent performs final synthesis.
- Surface TOML loading or unknown-agent errors; do not silently substitute a built-in agent.
