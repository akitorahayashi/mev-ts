const BAR_WIDTH = 24;
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_INTERVAL_MS = 80;

function renderLine(frame: string, completed: number, total: number): string {
  const filled =
    total === 0 ? BAR_WIDTH : Math.round((completed / total) * BAR_WIDTH);
  const bar = '━'.repeat(filled) + '─'.repeat(BAR_WIDTH - filled);
  const totalStr = String(total);
  const count = `${String(completed).padStart(totalStr.length)}/${totalStr}`;
  return `${frame} ${bar}  ${count}`;
}

export interface ProgressBar {
  tick(): void;
  stop(): void;
}

/**
 * A count-based progress bar with a timer-driven spinner so the line keeps
 * animating during a long-running apply rather than appearing frozen between
 * completions. On a non-TTY stream it stays silent; the caller prints the final
 * outcome table instead.
 */
export function createProgressBar(
  total: number,
  isTTY = process.stdout.isTTY ?? false,
): ProgressBar {
  let completed = 0;

  if (!isTTY) {
    return { tick() {}, stop() {} };
  }

  let frameIndex = 0;
  const draw = () => {
    const frame = SPINNER_FRAMES[frameIndex] as string;
    process.stdout.write(`\r${renderLine(frame, completed, total)}`);
  };

  draw();
  const timer = setInterval(() => {
    frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length;
    draw();
  }, SPINNER_INTERVAL_MS);

  return {
    tick() {
      completed += 1;
      draw();
    },
    stop() {
      clearInterval(timer);
      process.stdout.write('\r\x1b[2K');
    },
  };
}
