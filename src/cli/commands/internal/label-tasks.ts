import type { Command } from 'clipanion';
import type { CommandRunner } from '../../../host/command';
import type { LabelTask } from '../../../internal/gh/labels';
import { renderLiveList } from '../../tty/livelist';
import { runInternalCommand } from './command';

const LABEL_TASK_CONCURRENCY = 4;

/**
 * Shared execute body for the gh-label commands: build the reconciliation tasks
 * with `buildTasks`, then render them as a bounded-concurrency live list. The
 * deploy and reset commands differ only in which task builder they pass, so the
 * concurrency constant and the live-list wiring live here once.
 */
export function runLabelTasks(
  command: Command,
  buildTasks: (run: CommandRunner, repo?: string) => Promise<LabelTask[]>,
  repo?: string,
  // biome-ignore lint/suspicious/noConfusingVoidType: mirrors runInternalCommand's optional exit code.
): Promise<number | void> {
  return runInternalCommand(command, async (run) => {
    const tasks = await buildTasks(run, repo);
    await renderLiveList(
      tasks.map((task) => ({ label: task.name, run: () => task.apply() })),
      { concurrency: LABEL_TASK_CONCURRENCY },
    );
  });
}
