---
name: skill-guide
description: The user mentions Agent Skills or asks to organize reusable instructions, workflows, references, scripts, or templates as an agent skill.
---

## Agent Skills

Agent Skills are reusable instruction packages for AI agents. A skill must be understandable without the original conversation.

## What a skill carries

- Procedural skill: a task performed the same way each time, such as validation or conversion. It names each input and how the input is obtained, the output format, and the handling for a missing input. For persistent outputs, it also names the consumer, authoritative responsibility, and update semantics.
- Judgment skill: criteria applied while doing something else, such as design principles or naming rules. It names the decisions it governs and the criteria for each, and defines no inputs, no deliverable format, and no invocation situation, which the conversation supplies.

## Location

If the user specifies a location, create the skill there and put `SKILL.md` inside the skill directory.

Otherwise the skill belongs to the current project, at the first location that applies:

1. `.agents/skills/<skill-name>/`, when the project has `.agents/skills/`.
2. `.claude/skills/<skill-name>/`, when the project has `.claude/`.
3. `.agents/skills/<skill-name>/`, when neither exists.

A location under the home directory is used only when the user names one. [Claude Code](references/claude-code.md) and [Codex](references/codex.md) list the directories each tool searches.

## Required file

Every skill has a `SKILL.md`:

```markdown
---
name: <skill-name>
description: <What the skill does, and which requests reach for it.>
---

# <Skill Title>

<Reusable instructions, workflow, rules, or knowledge.>
```

`name` matches the skill directory name exactly, using 1–64 characters of lowercase letters, digits, and single hyphens, with no leading, trailing, or consecutive hyphen.

A skill name states what the skill does and carries no ordering prefix. Dependency between skills is expressed by the artifact each names as its input.

`description` states both what the skill does and which requests reach for it. It is the only routing information available before the skill is activated:

```yaml
description: Extracts text and tables from PDF files, fills forms, and merges documents. Use when the user asks about PDF extraction, PDF conversion, forms, or document merging.
```

A skill restricted to explicit user invocation is reached by name, so its `description` carries no routing information and states concisely, for the user choosing it, what the skill does:

```yaml
description: Drafts the questions research cannot answer, for the user to relay to another expert.
```

`compatibility` is optional and states the environment the skill requires, such as a runtime version or network access:

```yaml
compatibility: Requires Python 3.12 and network access
```

## Frontmatter and body

Frontmatter carries what the host application processes: identification, discovery, invocation policy, tool permissions, and compatibility. The Markdown body carries what the model follows: procedures, decision criteria, safety requirements, output format, and the conditions for reading supporting files, as the skill's kind requires. Whether frontmatter reaches the model is implementation-defined, so every instruction the model must follow appears in the body.

Host-specific frontmatter differs by tool. Read [Claude Code](references/claude-code.md) or [Codex](references/codex.md) when the skill sets invocation policy, model selection, or tool permissions.

## Optional supporting files

A skill may include supporting files next to `SKILL.md`:

```text
<skill-name>/
├── SKILL.md
├── references/  # Documents the agent may read, such as .md, .json, or .yaml
├── scripts/     # Programs the agent may run, such as .py, .sh, or .js
└── assets/      # Files used as input or output materials, such as templates, images, or data
```

Use only what the skill needs.

- `references/`: decision- or variant-specific knowledge. Each link states the condition that causes the skill to read it. Content used on every run belongs in `SKILL.md`.
- `scripts/`: repeatable validation, conversion, extraction, or generation logic. A script is not added for a decision that reading a file already settles. A check that the authoritative system already performs is not reimplemented in a script.
- `assets/`: templates, images, logos, sample inputs, configs, and data. An asset contains only the material its reader or consumer needs. Skill authoring rules, generation logic, classification rules, and operational procedures belong in `SKILL.md`. A placeholder names the value it holds in the reader's own vocabulary (`<PR number>`, not `<ID>`). A template is owned by the skill that fills it in; a blank form is emitted only for a human to fill.

## Scope discipline

- Define the skill's essential value as the single outcome or decision quality it uniquely improves. Include only the actions, criteria, outputs, failure handling, and knowledge required to deliver it.
- A shared concept has one owning skill. Each consuming skill names that owner as its handoff, reads it when coordination is part of the task, and states its own inputs, outputs, and local actions.
- Match additions to the skill's existing level of detail.
- Place new rules in the nearest owning section.
- Prefer tightening an existing rule over adding a parallel rule or section.

## Writing Guidelines

- Write declaratively; avoid including transitional or process-oriented information.
- Every sentence specifies an action, decision criterion, output or ownership contract, failure handling, or task-required knowledge.
- A rule appears once, in the section that owns it. An overview, a step, and a checklist do not restate the same rule.
- State desired actions, outputs, ownership, and allowed scope directly. Safety boundaries name the permitted operation and destination.
- For each input consumed, a procedural skill specifies how it is obtained and what happens if the input is missing (such as querying the user). Some skills—such as those introducing design concepts—do not involve inputs or outputs.

## Path rules

In `SKILL.md`, refer to supporting files relative to the skill directory, meaning the directory that contains `SKILL.md`.

Good:

```markdown
Read [format rules](references/format-rules.md).
Use [report template](assets/report-template.md).
Run [validator](scripts/validate.py).
```

`references/` is flat, and `SKILL.md` links each file directly.

Do not assume the shell current working directory is the skill directory. When a bundled script must be executed, resolve the script path relative to the skill directory and pass project files as explicit arguments.

## Creating or revising a skill

When creating or revising a skill:

1. Define the skill's essential value as one outcome or decision quality.
2. Choose or retain a clear `<skill-name>` that satisfies the `name` rules.
3. Create or update the skill directory at the requested location, or at the project location resolved above.
4. Write or revise the reusable workflow or knowledge in `SKILL.md`.
5. Add `references/`, `scripts/`, or `assets/` only when useful.
6. Link supporting files from `SKILL.md` using paths relative to the skill directory.
7. Review each instruction against the essential value, consolidate shared concepts at their owner, and preserve every consuming skill's local execution contract.
