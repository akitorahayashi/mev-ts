---
name: task-doc
description: Converts a software implementation request into a concise task document with current state, implementation plan, constraints, and acceptance criteria.
disable-model-invocation: true
---

# Task Doc

## Primary Objective

Organize requirements, context, and implementation work into a concise task document.

## Output Schema

The task document follows [template](assets/template.md), with each placeholder replaced by the task's own content.

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
