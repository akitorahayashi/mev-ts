## Documentation

- Conversational replies use the language the user is conversing in. Written documentation follows the repository's established language; when revising an existing document, its current language takes precedence over any default.
- Documentation for LLMs (AGENTS.md, CLAUDE.md, etc.) is kept concise for token efficiency, focusing only on essential information.
- Documentation is written in a declarative style describing the current state. Imperative or changelog-style descriptions are prohibited.
- Markdown structure matches the information: headings express hierarchy, tables express comparisons and state matrices, lists express independent rules or sequences, and prose is reserved for rationale and relationships.
- Documentation owns contracts, boundaries, rationale, and externally observable behavior. Source code, schemas, registries, and catalogs own implementation mechanics and enumerable values; documentation links to those authorities instead of reproducing them.
- The documentation must conform to the implementation, and the implementation must not be modified to conform to the documentation.
- Do not use bold emphasis (**) in Markdown. Use hierarchy and headings for organization.
