import { expect, test } from 'bun:test';
import { createTransientLine } from './transient-line';

function fakeStream(columns?: number) {
  let out = '';
  return {
    columns,
    write(chunk: unknown) {
      out += String(chunk);
      return true;
    },
    output: () => out,
  };
}

test('render clamps text to the stream width so the line never wraps', () => {
  const stream = fakeStream(20);
  const line = createTransientLine(stream as never);
  line.render('a'.repeat(30));
  const written = stream.output().replace('\r\x1b[2K', '');
  expect(written.length).toBeLessThan(20);
  expect(written.endsWith('…')).toBe(true);
});

test('render leaves text that fits within the width untouched', () => {
  const stream = fakeStream(20);
  const line = createTransientLine(stream as never);
  line.render('short');
  expect(stream.output()).toBe('\r\x1b[2Kshort');
});

test('render writes text unclamped when the stream reports no width', () => {
  const stream = fakeStream();
  const line = createTransientLine(stream as never);
  const text = 'a'.repeat(200);
  line.render(text);
  expect(stream.output()).toBe(`\r\x1b[2K${text}`);
});
