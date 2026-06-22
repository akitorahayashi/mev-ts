import { Listr } from 'listr2';

export interface LiveItem {
  label: string;
  run: () => Promise<void>;
}

export async function renderLiveList(
  items: LiveItem[],
  options: { concurrent: boolean },
): Promise<void> {
  const listr = new Listr(
    items.map((item) => ({ title: item.label, task: () => item.run() })),
    {
      concurrent: options.concurrent,
      rendererOptions: { collapseErrors: false },
    },
  );
  await listr.run();
}
