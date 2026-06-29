---
name: skill-guide
description: The user mentions Agent Skills or asks to organize reusable instructions as a skill.
---

# Agent Skills

Agent Skills are reusable instruction packages for AI agents.

A repository-scoped skill is stored at:

```text
.agents/skills/<skill-name>/SKILL.md
```

`SKILL.md` contains the skill name, the situations where it is relevant, and the instructions or knowledge the agent should follow.

Example:

```markdown
---
name: <skill-name>
description: <Describe the situations in which this skill is relevant.>
---

# <Skill Title>

<Write the skill content here.>
```

A skill may include optional supporting files:

```text
.agents/skills/<skill-name>/
├── SKILL.md
├── references/  # Documents the agent may read, such as .md, .json, or .yaml
├── scripts/     # Programs the agent may run, such as .py, .sh, or .js
└── assets/      # Files used as input or output materials, such as templates, images, or data
```

These directories and file formats are not required. Include only the files needed by the skill, and refer to them from `SKILL.md` using relative paths (which must be resolved relative to the skill's directory, e.g., `.agents/skills/<skill-name>/`).

When asked to organize something as a skill, create the directory `.agents/skills/<skill-name>/` and place the reusable knowledge or procedure in `SKILL.md` inside it.

The skill must be understandable without the original conversation.
