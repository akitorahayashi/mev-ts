import type { CommandRunner } from '../host/command';
import { runProcessStep } from '../host/command-run';
import type { Context } from '../host/context';

// The prefix is immutable for a host, so one probe serves every consumer in a
// run instead of each capability paying its own spawn. Keyed by the runner so
// injected fakes in tests never observe another context's answer.
const probes = new WeakMap<CommandRunner, Promise<string>>();

/** The Homebrew installation prefix, probed once per command runner. */
export function brewPrefix(context: Context): Promise<string> {
  const cached = probes.get(context.commands);
  if (cached) return cached;
  const probe = runProcessStep(
    context.commands,
    'brew',
    ['--prefix'],
    'brew --prefix failed',
  ).then((result) => result.stdout.trim());
  probes.set(context.commands, probe);
  return probe;
}
