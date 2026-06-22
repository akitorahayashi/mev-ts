import type { CAC } from 'cac';
import { renderTargetList } from '../tty/targetlist';

export function registerListCommand(program: CAC): void {
  program
    .command('list', 'List available targets.')
    .alias('ls')
    .action(() => {
      process.stdout.write(renderTargetList());
    });
}
