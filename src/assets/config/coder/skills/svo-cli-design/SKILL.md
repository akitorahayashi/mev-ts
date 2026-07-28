---
name: svo-cli-design
description: Use when designing or extending a CLI command surface (subcommands, positional arguments, options). Prevents mandatory-option sprawl, preserves positional-required inputs, keeps hierarchies shallow.
---

# SVO CLI Design

SVO reads a CLI invocation as a sentence: the tool is the subject, the subcommand the verb, the object the target, and positional args the required complements.

## Primary Objective

Prioritize SVO structure. Use positional arguments for primary required inputs. Reserve mandatory options for the conditions listed below, where an explicit key-value form resolves an ambiguity a positional argument cannot.

## Decision Order

1. Semantic sentence: `tool verb object complements`, where `object` is a subcommand noun in the command tree and `complements` are positional arguments. The `object` is omitted when it is inferable from the working context, such as a configuration file the tool already reads.
2. Input form:

   | input | form | condition |
   | --- | --- | --- |
   | Primary target of the verb | Subcommand noun | The vocabulary is closed and stable |
   | Required input | Positional argument | Default for every required input |
   | Required input | Mandatory option | Order-independence, repeated keyed input, externalized payload, or omission-is-normal |
   | Automatically resolvable value | Optional override, such as `--flag <value>` | The value resolves from environment variables, system information, or configuration |
   | Preference, edge case, part or numeric modifier, output mode | Option | Not needed on a daily invocation |

   Each mandatory option names which of the four conditions justifies it. An option matching none becomes a positional argument or an optional flag.
3. Command tree: shallow depth and a stable vocabulary.
4. Names: each command has exactly one canonical name. Aliases are registered short forms of that name — `init` → `i`, `update` → `u`, `--output` → `-o` — added when memorable and unambiguous. Two full-length names for one operation are synonyms and are not introduced.

## Contracts

- `stdout` carries result data; `stderr` carries warnings, logs, and errors.
- `--json` carries machine-readable output where a consumer exists.
- Each command declares its preconditions and enforces them with state validation. A satisfied state runs directly; a failed precondition reports the reason and the recovery action.

## Criteria

- Each resulting invocation reads as `tool verb object complements`. An invocation that does not read as a sentence, or that needs a mandatory option to state its primary target, is redesigned.
- The current CLI is the baseline, so the result is a set of deltas against it. A full redesign applies only when integration is impossible.
