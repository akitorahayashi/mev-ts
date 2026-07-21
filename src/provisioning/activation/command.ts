import { ProvisioningError } from '../../errors';
import { lstatIfPresent } from '../../host/absence';
import type { CommandOptions } from '../../host/command';
import type { Context } from '../../host/context';
import type {
  Activation,
  ActivationReport,
  ChangedWhen,
  CommandArg,
  CommandEnvValue,
  CommandRead,
  CommandScope,
  Described,
  StepGuard,
  StepReport,
} from './contract';
import { aggregateStatus, guarded } from './reconcile';

type CommandActivation = Extract<Activation, { kind: 'command' }>;

interface CommandInput {
  readonly label: string;
  readonly reads?: Readonly<Record<string, CommandRead>>;
  readonly steps: readonly CommandStep[];
}

type CommandStep = CommandActivation['steps'][number];

export function runCommand(input: CommandInput): Activation {
  for (const [index, step] of input.steps.entries()) {
    if (step.label.trim() === '') {
      throw new ProvisioningError(
        `Command activation '${input.label}' step ${index + 1} requires a non-empty label.`,
      );
    }
  }
  return { kind: 'command', ...input };
}

export function describeCommand(activation: CommandActivation): Described {
  return { verb: 'run', source: activation.label, dest: 'shell' };
}

/** Resolve a declarative argv token into zero or more concrete arguments. */
function resolveArg(arg: CommandArg, scope: CommandScope): string[] {
  if (typeof arg === 'string') return [arg];
  if ('ref' in arg) return [scope.ref(arg.ref)];
  if ('splitRef' in arg) {
    return scope.ref(arg.splitRef).split(/\s+/).filter(Boolean);
  }
  return [arg.concat.map((part) => resolveArg(part, scope).join('')).join('')];
}

function resolveArgs(
  args: readonly CommandArg[],
  scope: CommandScope,
): string[] {
  return args.flatMap((arg) => resolveArg(arg, scope));
}

function resolveEnvValue(value: CommandEnvValue, scope: CommandScope): string {
  if (typeof value === 'string') return value;
  if ('ref' in value) return scope.ref(value.ref);
  if ('concat' in value) {
    return value.concat
      .map((part) => resolveArg(part, scope).join(''))
      .join('');
  }
  return value.pathList
    .map((segment) => resolveArg(segment, scope).join(''))
    .filter(Boolean)
    .join(':');
}

function resolveEnv(
  env: Readonly<Record<string, CommandEnvValue>>,
  scope: CommandScope,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    resolved[name] = resolveEnvValue(value, scope);
  }
  return resolved;
}

type ResolvedGuard =
  | { readonly pathExists: string }
  | { readonly commandSucceeds: readonly string[] };

function resolveGuard(guard: StepGuard, scope: CommandScope): ResolvedGuard {
  if ('pathExists' in guard) {
    return { pathExists: resolveArg(guard.pathExists, scope).join('') };
  }
  return {
    commandSucceeds: guard.commandSucceeds.flatMap((arg) =>
      resolveArg(arg, scope),
    ),
  };
}

async function pathExists(path: string): Promise<boolean> {
  return (await lstatIfPresent(path)) !== null;
}

async function guardMatches(
  guard: ResolvedGuard,
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
  return !(stdout + stderr).includes(rule.outputNotContains);
}

function scopeFor(bindings: ReadonlyMap<string, string>): CommandScope {
  return {
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

export function commandReadKey(read: CommandRead): string {
  return typeof read === 'string' ? read : read.key;
}

/**
 * Seed the scope with the reserved host facts (`home`, `basePath`) and the assets
 * declared in `reads`, so every step's tokens resolve against one map. A `derive`
 * read binds a transform of the raw content; otherwise the trimmed value is bound
 * after an optional `validate`.
 */
async function readBindings(
  reads: Readonly<Record<string, CommandRead>>,
  context: Context,
): Promise<Map<string, string>> {
  const bindings = new Map<string, string>([
    ['home', context.home],
    ['basePath', context.basePath],
  ]);
  for (const [name, read] of Object.entries(reads)) {
    const key = commandReadKey(read);
    const raw = (await context.assets.read(key)).toString();
    if (typeof read !== 'string' && 'derive' in read) {
      bindings.set(name, read.derive(raw));
      continue;
    }
    const value = raw.trim();
    if (typeof read !== 'string') read.validate(value, key);
    bindings.set(name, value);
  }
  return bindings;
}

export async function runCommandActivation(
  activation: CommandActivation,
  context: Context,
): Promise<ActivationReport> {
  const base = describeCommand(activation);
  return guarded(base, async () => {
    const bindings = await readBindings(activation.reads ?? {}, context);
    const scope = scopeFor(bindings);
    const entries: StepReport[] = [];

    for (const step of activation.steps) {
      const argv = resolveArgs(step.argv, scope);
      const [command, ...args] = argv;
      const label = step.label;
      if (!command) {
        throw new ProvisioningError(
          `Command step '${label}' produced no argv.`,
        );
      }
      const env = step.env ? resolveEnv(step.env, scope) : undefined;

      if (
        step.skipIf &&
        (await guardMatches(resolveGuard(step.skipIf, scope), context, { env }))
      ) {
        entries.push({ key: label, value: 'skipped', status: 'unchanged' });
        continue;
      }

      const result = await context.commands.run(command, args, { env });

      if (result.code !== 0) {
        entries.push({
          key: label,
          value: argv.join(' '),
          status: 'failed',
          error: result.stderr.trim() || `exit code ${result.code}`,
        });
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
      entries.push({
        key: label,
        value: step.capture ? captured : argv.join(' '),
        status: didChange ? 'changed' : 'unchanged',
      });
    }

    return { ...base, status: aggregateStatus(entries), entries };
  });
}
