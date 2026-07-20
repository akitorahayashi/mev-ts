## Testing

- Test the owning boundary’s contract. Assert only externally observable behavior that the boundary explicitly owns.
- Respect dependency boundaries. Do not test behavior owned by dependencies; test only repository-owned behavior exposed through those boundaries.
- Avoid coupling tests to implementation structure. Do not freeze file placement, includes, wording, generated layout, or responsibility splits between nearby modules unless the tested boundary explicitly owns them as observable behavior.
- Use independent sources of truth. Derive expected results from an independent authority, never from the implementation under test, production-owned artifacts, or duplicated production logic.
- Keep migration checks out of durable tests. Check for residue from renames, deletions, and restructuring with implementation-time searches unless legacy handling is an explicit compatibility contract.
- Manage temporary artifacts safely. Use the language or runtime’s standard temporary-file and temporary-directory facilities when available, and ensure that anything created under `/tmp/` is removed even when the test fails.
