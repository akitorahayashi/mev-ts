---
name: jules-task-delegation
description: Delegate coding tasks to Google Jules via the Jules API. Activate when the user explicitly requests Jules involvement (e.g. "julesに依頼して", "delegate to Jules", "send to Jules").
---

# Jules Task Delegation

Delegate coding tasks to Google Jules by creating API sessions.

## Workflow

Use this skill only when the user explicitly asks for Jules involvement.

Clarify the task prompt before creating a session. The prompt is self-contained and includes the files, expected changes, constraints, and verification commands Jules needs.

Use the starting branch supplied by the user. When the user has not supplied one, inspect the current branch with `git branch --show-current` and ask whether Jules should start from that branch.

The Jules API key is read from `JULES_API_KEY`. When it is not already set, ask the user to create `.env` in the current working directory with `JULES_API_KEY=<key>`, then source that file for the session creation command.

## Create Session

Resolve the helper script relative to this `SKILL.md` file, not relative to the repository being delegated. Run it from the target repository so it can detect `remote.origin.url`.

```sh
set -a
source .env
set +a

bun <skill-dir>/scripts/create-session.ts \
  --prompt-file <prompt.md> \
  --branch <starting-branch>
```

Use `--prompt "..."` for short prompts. Use `--repo owner/repo` only when GitHub repository auto-detection is not possible.

Create multiple sessions serially.

## Reporting

After session creation, report the session name and URL. If creation fails, report the script's HTTP status and error body.
