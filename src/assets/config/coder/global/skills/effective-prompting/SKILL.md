---
name: effective-prompting
description: Maximize goal-output alignment with minimal cognitive and maintenance load.
---

# Effective Prompting

## Primary Objective

Maximize goal-output alignment with minimal cognitive and maintenance load.

## Design Workflow

1. Define the target output and acceptance checks first.
2. Resolve deterministic decisions upstream of the model.
3. Describe the right method, not micromanaged steps.
4. Separate always-true rules from situation-specific logic.
5. Add constraints only for real failure modes.
6. Remove duplicate or non-contributing instructions.
7. Validate the prompt against likely failure paths.

## Upstream Resolution Rule

If a decision can be resolved deterministically by non-model layers, resolve it before prompt delivery.

Examples of non-model layers:
- schema and output contracts
- runtime context injection
- assembly/template selection
- policy and routing logic

The model should receive resolved context, not meta-instructions about how to branch.

## Constraint Discipline

A constraint is justified only when both are true:
1. The model would plausibly violate it without the constraint.
2. The violation is not already prevented by output shape, context, or goal framing.

If either condition is false, remove the constraint.

## Guidance Discipline

- Prefer positive guidance ("what good looks like") over prohibition lists.
- Use hard language (`MUST`, `NEVER`, `ALWAYS`) only for high-impact boundaries.
- Specify evaluation criteria.

## Vocabulary Discipline

- Use self-evident terms for first-time readers.
- Avoid leaking internal implementation terms into prompt text.
- If a term needs extra explanation, replace the term instead of adding glossary overhead.

## Information Density

- State each rule once in its proper place.
- Do not repeat the same rule across sections.
- Remove any sentence that does not improve output quality or safety.

## Flexibility in Application

- When instructed to edit or modify, apply design rules to create or refine prompts accordingly.
- Even when review is requested, use design principles to evaluate, suggest improvements, and adapt flexibly to the context.

## Design Checklist

- Is the output unambiguous and verifiable?
- Are deterministic branches resolved upstream?
- Are invariant rules separated from situational logic?
- Does every constraint map to a concrete failure mode?
- Is any instruction duplicated?
- Would removing a line keep quality unchanged? If yes, remove it.
