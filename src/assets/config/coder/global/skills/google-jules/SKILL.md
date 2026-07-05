---
name: google-jules
description: Understand Google Jules and Jules API as an asynchronous cloud coding-agent service, including repository-backed and repoless sessions, PR automation, CI repair, and service boundaries.
---

# Google Jules

## Model

Google Jules is an asynchronous cloud coding agent for delegated software-development tasks. Jules API creates, observes, steers, approves, and collects results from those tasks.

Jules is a task-running agent, not an inline assistant or generic model API. It works in a cloud execution environment and reports reviewable progress and results.

Repository-backed tasks clone a repo in a fresh VM, install dependencies, modify files, run bounded verification when possible, and can produce patches, branches, or pull requests.

Repoless tasks run without a selected repo. They create an ephemeral dev environment from prompt context and can produce file outputs or artifacts for prototypes, scripts, examples, and planning.

Jules can generate plans, ask for feedback, expose an activity feed, produce code changes, and finish with outputs when the task context supports them.

## Fits

- Bug fixes in an existing repository
- Scoped feature, test, refactor, dependency, migration, or documentation work
- CI or deployment-failure repair when logs and repository context are available
- Workflow automation from issue trackers, chat, CI, or GitHub events
- Repoless exploration, prototypes, scripts, examples, and generated files

## Non-Fits

- A local machine operator that can directly inspect uncommitted local state
- A live IDE pair-programmer, inline completion system, or model inference endpoint
- A substitute for missing reproduction evidence, logs, setup instructions, repository state, or prompt-supplied artifacts
- A host for long-running dev servers, watchers, persistent debugging, or general shell automation

## API Concepts

- Session: one contiguous unit of work in one context.
- Source: an input source such as a connected GitHub repo.
- Source context: present for repository-backed sessions; optional for repoless sessions.
- Activity: an event such as plan, message, progress, completion, failure, or artifact.
- Plan approval is a control point before implementation when human review is needed.
- Pull request creation is an automation mode for applicable repository-backed changes.
- Artifacts can include code changes, command output, media, and file outputs.

## Branches

Jules appends a generated id to the branch name it creates, keeping branches unique. A branch naming convention supplied in the prompt is honored, with the id suffix applied on top of it.

Auto-merge is delegated to a repository workflow: define a branch naming convention, trigger the workflow on pull-request creation, and let it decide the merge from the branch name.

## Session Frame

Jules API work is framed first as a session design rather than endpoint syntax.

- Task prompt
- Repo and branch, or repoless prompt/artifact context
- Evidence: logs, failing commands, expected behavior, constraints, screenshots, images, setup requirements
- Approval mode
- Desired output: pull request, patch, file output, artifact, message, or status report

## Guidance

Local failures must be translated into accessible context: repo state, setup, logs, CI output, screenshots, images, or reproducible commands.

PR requests imply repository-backed work. Repoless sessions produce artifacts or files, not repository PRs.

Automation requests fit Jules API when another system owns task creation, polling, activity ingestion, follow-up messages, plan approval, or result collection.

Dev-server, watcher, and persistent-debugging requests do not fit Jules; use discrete setup and verification commands.

Verify official docs for availability, pricing, limits, model selection, endpoint fields, authentication, and API stability.
