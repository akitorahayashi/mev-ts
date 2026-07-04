import { dump, load } from 'js-yaml';

export function loadYaml(raw: string): unknown {
  return load(raw);
}

export function dumpYaml(value: unknown): string {
  return dump(value);
}
