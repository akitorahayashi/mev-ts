import { expect, test } from 'bun:test';
import { createTransientBlock } from './transient-block';

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

test('each progress row fits the terminal width', () => {
  const stream = fakeStream(20);
  const block = createTransientBlock(stream as never);
  block.render(['a'.repeat(30), 'short']);
  const rows = stream.output().split('\n\r');
  expect(rows.every((row) => row.length < 20)).toBe(true);
  expect(rows[0]?.endsWith('…')).toBe(true);
  expect(rows[1]).toBe('short');
});

test('progress is untruncated when no terminal width is supplied', () => {
  const stream = fakeStream();
  const text = 'a'.repeat(200);
  createTransientBlock(stream as never).render([text]);
  expect(stream.output()).toBe(text);
});

test('shrinking and clearing a block erase all previously occupied rows', () => {
  const stream = fakeStream();
  const block = createTransientBlock(stream as never);
  block.render(['header', 'claude', 'codex']);
  block.render(['header', 'codex']);
  expect(stream.output()).toContain('\r\x1b[2A\x1b[0Jheader\n\rcodex');
  block.clear();
  expect(stream.output().endsWith('\r\x1b[1A\x1b[0J')).toBe(true);
  const cleared = stream.output();
  block.clear();
  expect(stream.output()).toBe(cleared);
});
