import { lstat } from 'node:fs/promises';
import { ProvisioningError } from '../../errors';
import type { CommandOptions } from '../../host/command';
import type { Context } from '../../host/context';
import {
  type Activation,
  type ActivationReport,
  type ChangedWhen,
  type CommandScope,
  type CommandStep,
  type Described,
  errorMessage,
  type StepGuard,
  type StepReport,
} from './contract';

type CommandActivation = Extract<Activation, { kind: 'command' }>;

interface CommandInput {
  readonly label: string;
  readonly reads?: Readonly<Record<string, string>>;
  readonly steps: readonly CommandStep[];
}

export function runCommand(input: CommandInput): Activation {
  return { kind: 'command', ...input };
}

export function describeCommand(activation: CommandActivation): Described {
  return { verb: 'run', source: activation.label, dest: 'shell' };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function guardMatches(
  guard: StepGuard,
  context: Context,
  options?: CommandOptions,
): Promise<boolean> {
  if ('pathExists' in guard) {
    return pathExists(guard.pathExists);
  }
  const [command, ...args] = guard.commandSucceeds;
  if (!command) {
    throw new ProvisioningError('commandSucceeds guard requires a command.');
  }
  const result = await context.commands.run(command, args, options);
  return result.code === 0;
}

function classifyChange(
  rule: ChangedWhen | undefined,
  stdout: string,
  stderr: string,
): boolean {
  if (rule === undefined || rule === 'always') return true;
  if (rule === 'never') return false;
  if ('outputContains' in rule)
    return (stdout + stderr).includes(rule.outputContains);
  if ('outputNotContains' in rule)
    return !(stdout + stderr).includes(rule.outputNotContains);
  return stdout.includes(rule.stdoutContains);
}

function scopeFor(
  context: Context,
  bindings: ReadonlyMap<string, string>,
): CommandScope {
  return {
    home: context.home,
    basePath: process.env.PATH ?? '',
    ref(name) {
      const value = bindings.get(name);
      if (value === undefined) {
        throw new ProvisioningError(
          `Command step referenced unknown scope value '${name}'. Declare it in reads or capture it from an earlier step.`,
        );
      }
      return value;
    },
  };
}

function stepLabel(step: CommandStep, argv: readonly string[]): string {
  return (
    step.label ??
    (argv.length > 0 ? argv.slice(0, 2).join(' ') : 'unnamed step')
  );
}

/**
 * Read the assets declared in `reads` into the initial bindings, so a version
 * file surfaces as `s.ref('version')` to every step's thunk.
 */
async function readBindings(
  reads: Readonly<Record<string, string>>,
  context: Context,
): Promise<Map<string, string>> {
  const bindings = new Map<string, string>();
  for (const [name, key] of Object.entries(reads)) {
    bindings.set(name, (await context.assets.read(key)).toString().trim());
  }
  return bindings;
}

export async function runCommandActivation(
  activation: CommandActivation,
  context: Context,
  plan: boolean,
): Promise<ActivationReport> {
  const base = describeCommand(activation);
  try {
    if (plan) {
      return { ...base, status: 'changed' };
    }
    const bindings = await readBindings(activation.reads ?? {}, context);
    const entries: StepReport[] = [];
    let failed = false;
    let changed = false;

    for (const step of activation.steps) {
      const scope = scopeFor(context, bindings);
      const argv = step.argv(scope);
      const [command, ...args] = argv;
      const label = stepLabel(step, argv);
      if (!command) {
        throw new ProvisioningError(
          `Command step '${label}' produced no argv.`,
        );
      }

      if (
        step.skipIf &&
        (await guardMatches(step.skipIf(scope), context, {
          env: step.env?.(scope),
        }))
      ) {
        entries.push({ key: label, value: 'skipped', status: 'unchanged' });
        continue;
      }

      const result = await context.commands.run(command, args, {
        env: step.env?.(scope),
      });

      if (result.code !== 0) {
        entries.push({
          key: label,
          value: argv.join(' '),
          status: 'failed',
          error: result.stderr.trim() || `exit code ${result.code}`,
        });
        failed = true;
        break;
      }

      const captured = result.stdout.trim();
      if (step.capture) {
        bindings.set(step.capture, captured);
      }
      const didChange = classifyChange(
        step.changedWhen,
        result.stdout,
        result.stderr,
      );
      changed = changed || didChange;
      entries.push({
        key: label,
        value: step.capture ? captured : argv.join(' '),
        status: didChange ? 'changed' : 'unchanged',
      });
    }

    const status = failed ? 'failed' : changed ? 'changed' : 'unchanged';
    return { ...base, status, entries };
  } catch (error) {
    return { ...base, status: 'failed', error: errorMessage(error) };
  }
}
