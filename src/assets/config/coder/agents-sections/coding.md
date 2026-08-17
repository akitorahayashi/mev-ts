## Design

- Feature additions and refactorings include the removal of old modules and deprecated features to eliminate technical debt, bugs, and complexity.
- Class and file must not have ambiguous names or responsibilities such as base, common, core, utils, or helpers.
- Within a scoped directory, file and symbol names must not repeat the directory context;
  name them only by their specific responsibility.
- Files and classes identify single, specific responsibilities; names that restate package or directory scope are avoided to prevent unrelated concerns.
- Enumerable values are generated dynamically from authoritative sources (catalog, registry, schema) rather than hardcoded.
- Silent fallbacks are prohibited; any fallback is explicit, opt-in, and surfaced as a failure or a clearly logged, reviewed decision.
- UX simplicity is prioritized over excessive configuration.
- Validate necessity by contribution to purpose. Usage elsewhere is not a valid justification.
- Systemic fixes are preferred over patches; invariants and owning components are addressing at boundaries to benefit all call sites without workarounds.

## Comments

- Avoid writing comments whenever possible; if you do write them, keep them concise. Do not write comments if the code's purpose is obvious from the names or implementation.
- Include only information that cannot be gleaned from the code itself. Do not include descriptions that merely explain how the code works; such comments add no value and only reduce readability.
- What to include: reasons for choosing a specific implementation (including why other options were rejected), external constraints, past incidents, the rationale behind specifications, counter-intuitive behaviors, etc.
- What not to include: the mechanics of the code (details evident from the code), paraphrasing of function or variable names, or simple descriptions of actions (e.g., "initialize X").
- Do not use comments to address uncertainty in the implementation. Instead, explicitly communicate any uncertainties through interactions with users or in design documentation.

## Implementation

- Post-implementation inventorying (git status, git diff, etc.) is avoided; only evidential verification (testing, etc.) is performed.
- Validation focuses on the appropriate scope, providing minimal evidence unless intent dictates otherwise.
- When renaming, deleting, or restructuring, a comprehensive search (e.g., `rg`) for the old structure or terms must be performed at the end to ensure no remnants are left behind.
- Do not attempt to run the `check` command without first executing available auto-fix commands (such as `fix`). Please run the fix command if applicable before running the check.
- Avoid unnecessary actions, such as running the `test` command for changes unrelated to the implementation (e.g., modifications to Markdown files).
