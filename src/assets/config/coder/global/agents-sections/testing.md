## Testing

- Tests assert externally observable behavior at the owning boundary.
- A behavior is part of the test contract only when the boundary explicitly owns it.
- Tests do not freeze internal composition choices such as file placement, includes, wording, generated layout, or responsibility splits between nearby modules unless those are the observable behavior owned by the boundary.
- Rename, deletion, and restructuring residue checks belong to implementation-time search, not durable tests, unless legacy handling is itself an explicit contract.
- Use the language or runtime's standard temporary-file and temporary-directory facilities when available, and ensure that any artifacts created under `/tmp/` for testing are removed after the test, even if it fails.

