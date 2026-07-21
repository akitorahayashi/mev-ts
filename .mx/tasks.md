# mev-ts refactor — complete

Branch: `refactor/technical-debt-reduction` (11 commits on top of `main`).
All groups implemented; every acceptance check passes.

## Final state
- `bun run check` clean (biome + tsc, 258 files); `bun run test` 475 pass / 0 fail (90 files).
- `bun run build` compiles the binary; the integration suite passes on repeated runs.
- Sweeps clean: `rg intentVersion` none; `.mev` literals none outside host/path.ts;
  `internal/git/run.ts` absent; `summarizeActivationGroup` none.

## Commits (newest last is Phase 5)
- Group A (A1-A7) correctness/safety
- Group C (C1-C6) test-suite repairs
- B1-B3 + A3 (guard, report model, phase engine, aligned columns)
- B5/B6 (managed-link reconciler + deduped coder runners with per-dest isolation)
- B4, B7-B18 (remaining duplication → single owners)
- D3/D4 (CI pin + shellcheck; strict tsconfig flags)
- D5 (registry freshness guard + mermaid resolve assertion)
- D6 (unified progress on injectable stream + TTY-path tests)
- D1/B19 (declarative signature-hashed command steps; intentVersion removed;
  version-check + editor-target factories)
- D7 (in-place accepted-behavior notes)
- Phase 5 (AGENTS.md / docs/architecture.md / docs/testing.md conformance)

## Notes / recorded decisions honored
- D2: no descriptor table; switches remain (3 exhaustive + preflight switch-with-default).
- `.mx/requirements.md` was corrected per the audit but is gitignored (context storage),
  so it is not version-controlled by design.
- One accepted D1 limitation: a change to a read's custom `derive`/`validate` thunk body
  is not hashed (same class as any code change; the never-bumped intentVersion it replaced
  caught nothing). Structural argv/env/skipIf edits and asset content are hashed.
</content>
