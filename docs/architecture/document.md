# Document Conversion (internal/document/)

The hidden `mev internal document markdown-to-pdf` and `pdf-to-markdown` commands back the `md2pdf` and `pdf2md` shell aliases. The shell target owns both the aliases and their Pandoc, Poppler, and Google Chrome runtime dependencies.

Markdown-to-PDF first asks Pandoc for standalone HTML with Pygments syntax highlighting, MathML, embedded local resources, and the bundled print stylesheet. A Playwright-managed Chrome context blocks HTTP requests, renders fenced `mermaid` blocks from the Mermaid script embedded in the binary, and writes each PDF atomically. PDF-to-Markdown uses `pdftotext` for UTF-8 extraction and does not infer semantic Markdown structure. File and recursive-directory inputs share one planner that preserves relative paths, excludes a nested output directory, and rejects output collisions before conversion starts.

`mermaid` and `playwright-core` are exact-pinned (no caret) in `package.json`. The Mermaid script is imported by its deep `mermaid/dist/mermaid.min.js` path, bypassing the package's public API, so a minor release can relocate or reshape that file; `playwright-core` is pinned in lockstep with the `--external chromium-bidi/*` bundling workaround in `scripts/build-bundle.ts`, the shared build pipeline used by both `scripts/build.ts` and `scripts/install-mev.ts`; that pipeline also asserts at build time that `mermaid/dist/mermaid.min.js` resolves. Changing either pin is a deliberate, tested decision rather than a lockfile refresh.

## Binary Weight

The document subtree dominates what mev itself contributes to the compiled binary. Measured with the repository's own build flags, the binary is roughly 70 MB, of which about 60 MB is the Bun runtime that `bun build --compile` embeds in any binary; mev's own payload is the remaining ~10 MB, and the document subtree accounts for nearly all of it — the Mermaid script alone is ~3.4 MB embedded as a string, alongside a statically imported `playwright-core`. Two hidden commands therefore carry the bulk of the payload.

That is intentional, and follows the same rule as the embedded config assets (docs/architecture/assets.md): a single distributed binary that needs no install-time extraction and no network fetch to run. The consequence is that bumping `mermaid` or `playwright-core` is a whole-binary supply-chain decision rather than a routine dependency update, which is what the exact pins above exist to enforce. Re-measure rather than trusting these figures; nothing checks them.
