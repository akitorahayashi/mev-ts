---
name: skill-guide
description: The user mentions Agent Skills or asks to organize reusable instructions, workflows, references, scripts, or templates as an agent skill.
---

## Agent Skills

Agent Skills are reusable instruction packages for AI agents. A skill must be understandable without the original conversation.

## Location

If the user does not specify a location, create the skill under the current project:

```text
.agents/skills/<skill-name>/SKILL.md
```

If the user specifies a location, create the skill there and put `SKILL.md` inside the skill directory.

## Required file

Every skill has a `SKILL.md`:

```markdown
---
name: <skill-name>
description: <When this skill should be used.>
---

# <Skill Title>

<Reusable instructions, workflow, rules, or knowledge.>
```

The `description` should describe when to use the skill.

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

- `references/`: detailed rules, specs, schemas, examples, API notes
- `scripts/`: repeatable validation, conversion, extraction, or generation logic
- `assets/`: templates, images, logos, sample inputs, configs, data

## Scope discipline

- Match additions to the skill's existing level of detail.
- Place new rules in the nearest owning section.
- Prefer tightening an existing rule over adding a parallel rule or section.

## Path rules

In `SKILL.md`, refer to supporting files relative to the skill directory, meaning the directory that contains `SKILL.md`.

Good:

```markdown
Read [format rules](references/format-rules.md).
Use [report template](assets/report-template.md).
Run [validator](scripts/validate.py).
```

Do not assume the shell current working directory is the skill directory. When a bundled script must be executed, resolve the script path relative to the skill directory and pass project files as explicit arguments.

## Compact tables

Tables in skill text use fenced TSV by default:

```tsv
path	purpose	when_to_read
SKILL.md	Primary skill instructions	Always
references/	Detailed rules, specs, examples	Only when directly relevant
scripts/	Repeatable validation or conversion logic	When execution is useful
assets/	Templates, images, sample inputs	When the task needs material
```

Use Markdown tables only when rendered visual scanning is part of the skill's purpose. If cells may contain tabs, multiline values, or nested data, use YAML list records instead.

This TSV default is scoped to skill text consumed by agents. It does not apply to user-facing conversation replies or to documentation meant for human readers, such as README.md; those contexts keep rendered Markdown tables.

## Creating a skill

When asked to organize something as a skill:

1. Choose a clear `<skill-name>`.
2. Create the skill directory at the requested location, or under `.agents/skills/` if no location is specified.
3. Write the reusable workflow or knowledge in `SKILL.md`.
4. Add `references/`, `scripts/`, or `assets/` only when useful.
5. Link supporting files from `SKILL.md` using paths relative to the skill directory.
