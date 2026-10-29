import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { errorMessage } from '../src/errors';
import {
  detectArch,
  fetchReleaseBinary,
  latestTag,
  parseReleaseBinaries,
} from '../src/github/release';
import { STOCK_SSH_HOST } from '../src/github/repository';
import { renderConfig } from '../src/grove/config';
import { runWithCleanup } from '../src/host/cleanup-error';
import { bunCommandRunner } from '../src/host/command';
import { runProcessStep } from '../src/host/command-run';

const GROVE_ROLE = join(import.meta.dir, '..', 'src/assets/config/grove');

/**
 * Validate the embedded catalog with the gv release it pins, so a schema the
 * pinned release rejects fails CI instead of the next `mev make grove`. The
 * assets are read from the source tree because registry.generated.ts is
 * gitignored and this job runs no codegen.
 */
async function verifyGrovePin(): Promise<void> {
  const manifestPath = join(GROVE_ROLE, 'binaries.yml');
  const gv = parseReleaseBinaries(
    await readFile(manifestPath, 'utf8'),
    manifestPath,
  ).find((binary) => binary.name === 'gv');
  if (!gv || gv.tag === latestTag) {
    throw new Error(`${manifestPath} must pin gv to a release tag.`);
  }
  const catalogPath = join(GROVE_ROLE, 'grove.toml');
  const rendered = renderConfig(
    await readFile(catalogPath, 'utf8'),
    STOCK_SSH_HOST,
    catalogPath,
  );
  const context = { commands: bunCommandRunner };
  const workspace = await mkdtemp(join(tmpdir(), 'mev-grove-pin-'));
  await runWithCleanup(
    async () => {
      const binary = join(workspace, 'gv');
      await fetchReleaseBinary(
        gv,
        gv.tag,
        await detectArch(context),
        binary,
        context,
      );
      const config = join(workspace, 'catalog', 'grove.toml');
      await mkdir(join(workspace, 'catalog'));
      await writeFile(config, rendered);
      await runProcessStep(
        context.commands,
        binary,
        ['validate', '--config', config],
        `gv ${gv.tag} rejected the rendered ${catalogPath}; gv validate exited`,
        { stdout: 'inherit', stderr: 'inherit', fallback: 'see output above' },
      );
    },
    () => rm(workspace, { force: true, recursive: true }),
    `Failed to remove the Grove pin workspace ${workspace}.`,
  );
}

if (import.meta.main) {
  try {
    await verifyGrovePin();
  } catch (error) {
    console.error(errorMessage(error));
    process.exit(1);
  }
}
