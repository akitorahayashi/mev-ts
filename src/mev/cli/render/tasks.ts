import { Listr } from 'listr2';

export interface Task {
  label: string;
  run: () => Promise<void>;
}

export async function runTasks(
  tasks: Task[],
  options: { concurrent: boolean },
): Promise<void> {
  const listr = new Listr(
    tasks.map((t) => ({ title: t.label, task: () => t.run() })),
    {
      concurrent: options.concurrent,
      rendererOptions: { collapseErrors: false },
    },
  );
  await listr.run();
}
