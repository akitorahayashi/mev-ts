## Safety

- Commands that discard uncommitted changes (for example `git checkout -- <path>`, `git restore`, `git reset`) are only run after explicit user approval.
- A request to create branches, commit, push, or perform other Git write operations apply only to the changes requested at that time and do not serve as permanent instructions for subsequent changes.

## User-specific

- `.mx/*.md` files are context-file storage. Read only upon explicit instruction.
- Relative path references to `references/` are prohibited (primarily because it's a clone for reference purposes). If you need the assets (JSON/images, etc.) within it, please copy them as appropriate.
- Dependencies and GitHub Actions owned by `akitorahayashi` use reviewed release or major tags rather than SHA pins. Third-party GitHub Actions and Git-hosted dependencies use immutable full commit SHAs.
