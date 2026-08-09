---
name: effective-prompting
description: Use this when creating, editing, or reviewing prompts, system instructions, or agent instructions for LLMs.
---

# Effective Prompting

## Primary Objective

Maximize alignment between goals and output while minimizing cognitive and maintenance overhead.

## Design Workflow

1. Define the target output and acceptance criteria (checkpoints) first.
2. Handle deterministically resolvable decisions upstream (before passing data to the model).
3. Describe desired behaviors rather than listing granular prohibitions.
4. Separate universally applicable rules from context-specific logic.
5. Apply "Constraint Discipline" principles to each candidate constraint.
6. Apply rules regarding information density.
7. Validate the prompt against potential failure patterns.

## Upstream Resolution Rules

Resolve decisions that can be handled deterministically outside the model layer before sending the prompt.

Examples of non-model layers:

- Schemas and output contracts
- Runtime context injection
- Assembly/template selection
- Policy and routing logic

Pass resolved context to the model, rather than meta-instructions on how to branch logic.

## Constraint Discipline Principles

A constraint is justified only if both of the following conditions are met:

1. Without the constraint, the model is likely to violate it.
2. The violation is not already prevented by the output format, context, or goal definition.

Remove the constraint if either condition is not met.

## Guidance Principles

- Prioritize positive guidance (describing the "ideal state") over lists of prohibitions.
- Reserve strong language (e.g., `MUST`, `NEVER`, `ALWAYS`) for critical boundary conditions. - Clearly state the evaluation criteria.

## Principles of Terminology

- Use terms that are self-explanatory even to first-time readers.
- Avoid including internal implementation terminology in the prompt text.
- If a term requires additional explanation, replace the term itself rather than creating a glossary.

## Information Density

- State each rule only once, in the appropriate location.
- Do not repeat the same rule across multiple sections.
- Align additional content with the document's existing level of granularity.
- Prioritize replacing or refining existing rules over adding new sections.

## Flexibility in Application

- When instructed to edit or revise, apply the design rules to create or refine the prompt accordingly.
- Even when a review is requested, offer evaluations and improvement suggestions based on design principles, and respond flexibly to the situation.

## Design Checklist

- Are deterministic branches resolved upstream (at an earlier stage)?
- Are invariant rules separated from context-dependent logic?
- Do all constraints address specific failure modes (patterns of failure)?
- Are there any redundant instructions?
- Does deleting a line affect quality? If not, delete that line.
