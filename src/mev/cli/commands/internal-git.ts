import type { CAC } from 'cac';
import { defaultBranch, deleteMergedBranches } from '../../internal/git/repo';
import { bunCommandRunner } from '../../runtime/command';

export function registerInternalGitCommands(program: CAC): void {
  program
    .command(
      'git delete-branches',
      'Delete local branches already merged into the default branch.',
    )
    .action(async (): Promise<void> => {
      const cwd = process.cwd();
      const base = await defaultBranch(bunCommandRunner, cwd);
      const deleted = await deleteMergedBranches(bunCommandRunner, cwd, base);

      if (deleted.length === 0) {
        process.stdout.write('No merged branches to delete.\n');
      } else {
        for (const branch of deleted) {
          process.stdout.write(`Deleted: ${branch}\n`);
        }
      }
    });
}
