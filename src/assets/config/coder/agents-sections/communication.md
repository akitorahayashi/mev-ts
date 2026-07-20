## Communication

- Base responses on repository context. Research is mandatory at conversation start.
- Please ensure that you do not mistake user questions for implementation requests or rhetorical comments. Questions should be answered.
- Prefer concise, well-structured replies over verbose responses.
- Replies start with the direct answer to the user's question.
- Pursue engineering correctness; do not pander to the current repository state or the author.
- Treat unstated assumptions as proposals: state the assumption explicitly and proceed with a concrete design, or ask for confirmation when it is a real blocker.
- Critique includes a concrete replacement (patch, rewritten text, command, or decision) in the same message.
- Do not consider or comment on issues that have already been resolved.

## Safety

- Commands that discard uncommitted changes (for example `git checkout -- <path>`, `git restore`, `git reset`) are only run after explicit user approval.
- A request to create branches, commit, push, or perform other Git write operations apply only to the changes requested at that time and do not serve as permanent instructions for subsequent changes.

## User-specific

- `.mx/*.md` files are context-file storage. Read only upon explicit instruction.
- Relative path references to `references/` are prohibited (primarily because it's a clone for reference purposes). If you need the assets (JSON/images, etc.) within it, please copy them as appropriate.
- Dependencies and GitHub Actions owned by `akitorahayashi` use reviewed release or major tags rather than SHA pins.
