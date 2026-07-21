/**
 * Generates `src/assets/registry.generated.ts` by walking the config
 * tree under `src/assets/config/`. Each file's content is inlined as a
 * string keyed by its path relative to that root, so the compiled binary
 * embeds every asset without per-file imports or filesystem access at runtime.
 * A file whose source carries the owner-execute bit is also listed in
 * `executableAssets` so deployment restores that bit; scripts invoked directly
 * (statusline commands) need it. A `registrySourceHash` over the source tree is
 * embedded so `validate-assets` can detect a stale registry.
 *
 * The asset directory is the single source of truth: adding a feature's files
 * regenerates the registry without hand-editing any enumeration.
 */

import { relative } from 'node:path';
import { collectAssets, registryFile, renderRegistry } from './asset-registry';

const entries = await collectAssets();
await Bun.write(registryFile, renderRegistry(entries));

const executableCount = entries.filter((entry) => entry.executable).length;
console.log(
  `Generated ${relative(process.cwd(), registryFile)} (${entries.length} assets, ${executableCount} executable).`,
);
