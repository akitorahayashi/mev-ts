const BAR_WIDTH = 24;

function renderBarLine(
  completed: number,
  total: number,
  label?: string,
): string {
  const filled =
    total === 0 ? BAR_WIDTH : Math.round((completed / total) * BAR_WIDTH);
  const bar = '━'.repeat(filled) + '─'.repeat(BAR_WIDTH - filled);
  const totalStr = String(total);
  const count = `${String(completed).padStart(totalStr.length)}/${totalStr}`;
  const suffix = label ? `  ${label}` : '';
  return `  ${bar}  ${count}${suffix}`;
}

export interface ProgressBar {
  tick(label?: string): void;
  stop(): void;
}

export function createProgressBar(
  total: number,
  isTTY = process.stdout.isTTY ?? false,
): ProgressBar {
  let completed = 0;

  return {
    tick(label?: string) {
      completed += 1;
      if (isTTY) {
        process.stdout.write(`\r${renderBarLine(completed, total, label)}`);
      } else {
        const totalStr = String(total);
        const n = String(completed).padStart(totalStr.length);
        process.stdout.write(`[${n}/${totalStr}]  ${label ?? ''}\n`);
      }
    },
    stop() {
      if (isTTY) {
        process.stdout.write('\r\x1b[2K');
      }
    },
  };
}
