import { makeStyle } from './style';

const BAR_WIDTH = 24;
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_INTERVAL_MS = 80;

function renderLine(
  frame: string,
  completed: number,
  total: number,
  label: string,
  c: ReturnType<typeof makeStyle>,
): string {
  const filled =
    total === 0
      ? BAR_WIDTH
      : Math.min(BAR_WIDTH, Math.round((completed / total) * BAR_WIDTH));
  const bar =
    c.cyan('━'.repeat(filled)) + c.dim('─'.repeat(BAR_WIDTH - filled));
  const totalStr = String(total);
  const count = `${String(completed).padStart(totalStr.length)}/${totalStr}`;
  const prefix = `${c.cyan(frame)} ${bar}  ${count}`;
  return label ? `${prefix}  ${c.dim(label)}` : prefix;
}

export interface ProgressBar {
  setLabel(label: string): void;
  tick(): void;
  stop(): void;
}

export function createProgressBar(
  total: number,
  isTTY = process.stdout.isTTY ?? false,
): ProgressBar {
  let completed = 0;
  let label = '';

  if (!isTTY) {
    return { setLabel() {}, tick() {}, stop() {} };
  }

  const c = makeStyle(true);
  let frameIndex = 0;
  const draw = () => {
    const frame = SPINNER_FRAMES[frameIndex] as string;
    process.stdout.write(
      `\x1b[2K\r${renderLine(frame, completed, total, label, c)}`,
    );
  };

  draw();
  const timer = setInterval(() => {
    frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length;
    draw();
  }, SPINNER_INTERVAL_MS);

  let stopped = false;
  return {
    setLabel(nextLabel) {
      label = nextLabel;
      draw();
    },
    tick() {
      completed += 1;
      draw();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      process.stdout.write(
        `\x1b[2K\r${renderLine(' ', completed, total, '', c)}\n`,
      );
    },
  };
}
