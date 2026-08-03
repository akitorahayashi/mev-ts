---
name: agent-guide
description: Creates and revises Claude Code subagents and Codex custom agents, including delegation contracts, tools, permissions, and model settings.
---

# Custom Agents

## Scope

A custom agent is an execution role with its own instructions and context. This guide covers Claude Code subagents and Codex custom agents. It does not cover repository instruction files such as `AGENTS.md` or `CLAUDE.md`.

## Choosing the Mechanism

Use the main conversation when the work needs frequent user interaction, shares substantial context across phases, or is a small direct task.

Use a skill when reusable instructions should operate in the current conversation and do not need an isolated context, distinct model, or restricted tool surface.

Use an agent when at least one of these properties contributes to the task:

- isolated context keeps verbose investigation or tool output out of the parent
- a specialized instruction set improves a bounded task
- the task needs a narrower tool, permission, model, or reasoning configuration
- independent work can run concurrently
- a resumable worker must retain its own task history

An agent is not introduced only to rename a phase of a workflow.

## Required Context

Determine the target host, scope, responsibility, caller, inputs, output, tool needs, write ownership, and completion condition from the request and existing configuration.

Existing `.claude/agents/`, `.codex/agents/`, plugin roots, and user-level agent directories identify the host and local conventions. When the host or scope remains ambiguous and the resulting formats would differ, obtain that decision from the user before writing files.

## Responsibility Contract

- One agent owns one specific job whose result can be evaluated independently.
- The description states what the agent does and when a caller delegates to it.
- The persistent agent instructions define invariant behavior. The delegation message supplies task-specific paths, identifiers, ranges, and acceptance conditions.
- Every consumed input names how the agent receives or discovers it and what happens when it is absent.
- The output contract defines the returned content, structure, evidence, and failure representation.
- The caller owns orchestration, user interaction, cross-agent decisions, and final integration unless the contract explicitly assigns one of them to the agent.
- Adjacent work that belongs to the caller or another agent remains outside the agent's responsibility.

An agent definition is understandable without the conversation that created it.

## Context Contract

Assume a delegated agent does not know the parent's conversation, previously read files, invoked skills, or unstated decisions. Put durable rules in the agent definition and current task facts in the delegation message. Do not duplicate information that the host reliably injects.

Agent results return distilled findings or requested artifacts rather than raw exploratory output. A result distinguishes completed work, unresolved questions, and failures instead of silently omitting unfinished parts.

## Tools and Permissions

- Grant the smallest tool surface that completes the responsibility.
- Analysis-only, review, and discovery agents remain read-only.
- Write access belongs only to an agent whose contract owns a concrete output or implementation boundary.
- Shell access is granted for named command categories the work requires, not as a substitute for missing tool design.
- External services are exposed only through the MCP servers or credentials the responsibility needs.
- A parent session's approval and sandbox policy remains an outer boundary; an agent definition does not promise broader authority.

Model and reasoning settings follow task difficulty. Fast models fit narrow search and extraction; stronger reasoning fits ambiguous synthesis, correctness review, and multi-step diagnosis. Inheritance is preferred when specialization has no demonstrated benefit.

## Delegation and Concurrency

- Each delegation message is self-contained and bounded.
- Parallel agents receive independent work with no shared write ownership.
- Work with ordering dependencies is delegated sequentially, passing only the prior result needed by the next agent.
- The parent waits for every required result before synthesis.
- Follow-up work resumes the same agent when its retained context is material; otherwise a new invocation receives a complete task message.
- Agent output is treated as evidence for parent review, not as an automatically accepted decision.

## Authoring Workflow

1. Select the main conversation, a skill, or an agent from the task properties.
2. Define the agent's single responsibility and its exclusion boundary.
3. Define inputs, missing-input behavior, output, evidence, and completion conditions.
4. Assign tool access, permissions, model, reasoning effort, and isolation from demonstrated needs.
5. Write routing metadata and host-specific instructions in the host's format.
6. Invoke the agent with a representative bounded task.
7. Verify that the correct agent ran, received sufficient context, stayed within its boundary, and returned the declared output.

## Host Formats

Read [Claude Code](references/claude-code.md) for Markdown subagents, scope precedence, context loading, and plugin-agent restrictions.

Read [Codex](references/codex.md) for TOML custom agents, configuration inheritance, and subagent settings.

When a Claude Code plugin ships an agent, apply the custom-agent contract here and the plugin packaging rules from the plugin's owning guide.
