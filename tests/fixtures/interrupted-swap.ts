import { join, resolve } from 'node:path';
import type { SwapPaths } from '../../src/host/transaction';

type Boundary = 'prepared' | 'backed-up' | 'replaced' | 'published';

// A real process is necessary to interrupt the persisted rename protocol.
export async function interruptSwap(
  home: string,
  boundary: Boundary,
  replacement = 'directory',
  dest = join(home, 'managed/resource'),
): Promise<SwapPaths> {
  const child = Bun.spawn(
    [
      process.execPath,
      '-e',
      `
    import { cp, mkdir, symlink, writeFile } from 'node:fs/promises';
    import { join } from 'node:path';
    import { withHomeMutation } from ${JSON.stringify(resolve('src/app/mutation.ts'))};
    import { withSwapTransaction } from ${JSON.stringify(resolve('src/host/transaction.ts'))};
    const home = process.env.MEV_TEST_HOME;
    await withHomeMutation(home, 'interrupted swap', () =>
      withSwapTransaction(process.env.MEV_TEST_DEST, 'recovery scenario', async ({staged, install}) => {
        if (process.env.MEV_TEST_REPLACEMENT === 'directory') {
          await mkdir(staged);
          await writeFile(join(staged, 'new.txt'), 'new contents');
        } else if (process.env.MEV_TEST_REPLACEMENT === 'copy') {
          await cp(process.env.MEV_TEST_DEST, staged, {recursive: true, preserveTimestamps: true});
        } else if (process.env.MEV_TEST_REPLACEMENT === 'symlink') {
          await symlink(join(home, 'link-target'), staged);
        } else await writeFile(staged, 'new file');
        await install();
      }, {home, async onBoundary(phase, paths) {
        if (phase === process.env.MEV_TEST_BOUNDARY) {
          console.log(JSON.stringify(paths));
          await Bun.stdin.text();
        }
      }})
    );
  `,
    ],
    {
      env: {
        ...Bun.env,
        MEV_TEST_HOME: home,
        MEV_TEST_DEST: dest,
        MEV_TEST_BOUNDARY: boundary,
        MEV_TEST_REPLACEMENT: replacement,
      },
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  try {
    const reader = child.stdout.getReader();
    let text = '';
    const decoder = new TextDecoder();
    while (!text.includes('\n')) {
      const next = await reader.read();
      if (next.done)
        throw new Error(
          `Swap child failed: ${await new Response(child.stderr).text()}`,
        );
      text += decoder.decode(next.value);
    }
    reader.releaseLock();
    const paths = JSON.parse(text.trim()) as SwapPaths;
    child.kill('SIGKILL');
    await child.exited;
    return paths;
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
    await child.exited;
  }
}
