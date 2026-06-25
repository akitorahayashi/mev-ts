---
name: svo-cli-design
description: Design CLI surfaces with SVO model (subcommand + object + args). Prevents mandatory-option sprawl, preserves positional-required inputs, keeps hierarchies shallow.
---

# SVO CLI Design

## Primary Objective

Prioritize SVO structure. Use positional arguments for primary required inputs. Employ mandatory options selectively when explicit key-value definitions improve clarity or reduce ambiguity.

## Decision Workflow

1. Semantic sentence: `verb object required-inputs`
   - Allow omitting `object` in the CLI if it can typically be inferred implicitly from the context of the current directory, such as a configuration file.
2. Required inputs: Positional args by default
3. Options:
   - Additive behaviors based on user preference
   - Limited usages and edge cases not needed daily
   - Modifiers for specific parts or numerical values of regular behavior
   - Output modes and safety flags
   - Context overrides: Use options (e.g., `--flag <value>`) instead of positional arguments to explicitly force a different value for something that can be automatically resolved via environment variables, system information, or configuration files.
4. Mandatory options allowed only when:
   - Order-independence needed
   - Repeated keyed input needed
   - Payload too large/externalized
   - Omission is normal (explicit toggle safer)
5. Command tree: Shallow depth, stable vocabulary, no synonyms
6. Aliases: Provide short forms for commands and options (e.g., `init`→`i`, `update`→`u`, `--output`→`-o`)
7. Operational contracts:
   - `stdout`: result data
   - `stderr`: warnings/logs/errors
   - `--json`: machine output when needed
8. Destructive ops: Require confirmation/dry-run, `--yes`/`--force` override, `stderr` warning, non-zero exit on failure

## Existing CLI Rule

Current CLI is baseline. Propose deltas only. Redesign only if integration impossible.
