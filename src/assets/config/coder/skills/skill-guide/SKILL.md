---
name: skill-guide
description: The user mentions Agent Skills or asks to organize reusable instructions, workflows, references, scripts, or templates as an agent skill.
---

## Agent Skills

Agent Skills are reusable instruction packages for AI agents. A skill must be understandable without the original conversation.

## Location

If the user specifies a location, create the skill there and put `SKILL.md` inside the skill directory.

Otherwise the skill belongs to the current project, at the first location that applies:

```tsv
condition	location
The project has .agents/skills/	.agents/skills/<skill-name>/
The project has .claude/	.claude/skills/<skill-name>/
Neither exists	.agents/skills/<skill-name>/
```

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

`name` matches the skill directory name exactly, using 1–64 characters of lowercase letters, digits, and interior hyphens.

`description` states both what the skill does and which requests reach for it. It is the only routing information available before the skill is activated:

```yaml
description: Extracts text and tables from PDF files, fills forms, and merges documents. Use when the user asks about PDF extraction, PDF conversion, forms, or document merging.
```

`compatibility` is optional and states the environment the skill requires, such as a runtime version or network access:

```yaml
compatibility: Requires Python 3.12 and network access
```

## Frontmatter and body

Frontmatter carries what the host application processes: identification, discovery, invocation policy, tool permissions, and compatibility. The Markdown body carries what the model follows: procedures, decision criteria, safety requirements, output format, and the conditions for reading supporting files. Whether frontmatter reaches the model is implementation-defined, so every instruction the model must follow appears in the body.

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

- `references/`: detailed rules, specs, schemas, examples, API notes
- `scripts/`: repeatable validation, conversion, extraction, or generation logic
- `assets/`: templates, images, logos, sample inputs, configs, data

`SKILL.md` holds knowledge every run needs; `references/` holds content whose reading depends on the situation, so content read on every run belongs in `SKILL.md`. A script is not added for a decision that reading a file already settles. A template in `assets/` is owned by the skill that fills it in; a blank form is emitted only for a human to fill.

## Scope discipline

- Match additions to the skill's existing level of detail.
- Place new rules in the nearest owning section.
- Prefer tightening an existing rule over adding a parallel rule or section.

## Writing Guidelines

- Write declaratively; avoid including transitional or process-oriented information.
- Target prohibitions at actions that could actually occur within the workflow. Prohibiting actions that cannot happen creates noise and serves no purpose. Whenever possible, opt for clear instructions rather than prohibitions.
- For all input information, explicitly state how it is obtained and how to handle cases where the information is missing (e.g., asking the user).

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

1. Choose a clear `<skill-name>` that satisfies the `name` rules.
2. Create the skill directory at the requested location, or at the project location resolved above.
3. Write the reusable workflow or knowledge in `SKILL.md`.
4. Add `references/`, `scripts/`, or `assets/` only when useful.
5. Link supporting files from `SKILL.md` using paths relative to the skill directory.
