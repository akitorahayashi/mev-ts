---
name: task-doc
description: Organize requirements and tasks into concise task documents, especially requests like "put this into a task document".
---

# Task Doc

## Primary Objective

Organize requirements, context, and implementation work into a concise task document.

## When To Use

This skill applies when the user asks to create, write, organize, or convert requirements and tasks into a task document.

Common trigger phrasing includes:
- "put this into a task document"
- "turn this into a task document"
- "create a task document for ..."

## Output Schema

```md
## Goal

<desired outcome>

## Current State

<what currently exists and why it is insufficient>
- `<relevant file/module/component>`: <current responsibility and problem>

## Plan

1. <step>
2. <step>

## Constraints

- <constraint or assumption>

## Acceptance Criteria

- <externally observable completion condition>
```

## Schema Meaning

- `Goal`: The target outcome, not the implementation steps.
- `Current State`: Existing behavior, structure, or context and why it fails to meet the goal. Include relevant files, modules, or components only when known from context.
- `Plan`: Ordered implementation approach at the right abstraction level.
- `Constraints`: Requirements, assumptions, boundaries, and non-goals that shape the work.
- `Acceptance Criteria`: Observable conditions that prove the task is complete.

## Additional Context

Additional headings belong at the most appropriate position in the document only when the schema cannot cover the information cleanly, such as notable background, domain-specific requirements, domain information, implementation details, library usage, migration notes, or reviewed decisions.

## Style

The entire task document remains in declarative style, including user-requested revisions.
