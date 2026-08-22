import { ProvisioningError } from '../../errors';
import { lstatIfPresent } from '../../host/absence';
import type { CommandOptions, CommandResult } from '../../host/command';
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
type CommandInput = Omit<CommandActivation, 'kind'>;

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

function resolveArg(arg: CommandArg, scope: CommandScope): string[] {
  if (typeof arg === 'string') return [arg];
  if ('ref' in arg) return [scope.ref(arg.ref)];
  if ('splitRef' in arg) {
    return scope.ref(arg.splitRef).split(/\s+/).filter(Boolean);
  }
  return [arg.concat.map((part) => resolveArg(part, scope).join('')).join('')];
}

export function resolveArgs(
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

export function resolveEnv(
  env: Readonly<Record<string, CommandEnvValue>>,
  scope: CommandScope,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    resolved[name] = resolveEnvValue(value, scope);
  }
  return resolved;
}

export type ResolvedGuard =
  | { readonly pathExists: string }
  | { readonly commandSucceeds: readonly string[] }
  | {
      readonly commandOutputMatches: {
        readonly argv: readonly string[];
        readonly exact?: string;
        readonly contains?: string;
      };
    };

export function resolveGuard(
  guard: StepGuard,
  scope: CommandScope,
): ResolvedGuard {
  if ('pathExists' in guard) {
    return { pathExists: resolveArg(guard.pathExists, scope).join('') };
  }
  if ('commandOutputMatches' in guard) {
    const { argv, exact, contains } = guard.commandOutputMatches;
    return {
      commandOutputMatches: {
        argv: argv.flatMap((arg) => resolveArg(arg, scope)),
        ...(exact === undefined
          ? {}
          : { exact: resolveArg(exact, scope).join('') }),
        ...(contains === undefined
          ? {}
          : { contains: resolveArg(contains, scope).join('') }),
      },
    };
  }
  return {
    commandSucceeds: guard.commandSucceeds.flatMap((arg) =>
      resolveArg(arg, scope),
    ),
  };
}

async function runsSuccessfully(
  argv: readonly string[],
  label: string,
  context: Context,
  options?: CommandOptions,
): Promise<CommandResult> {
  const [command, ...args] = argv;
  if (!command) {
    throw new ProvisioningError(`${label} guard requires a command.`);
  }
  return context.commands.run(command, args, options);
}

async function pathExists(path: string): Promise<boolean> {
  return (await lstatIfPresent(path)) !== null;
}

export async function guardMatches(
  guard: ResolvedGuard,
  context: Context,
  options?: CommandOptions,
): Promise<boolean> {
  if ('pathExists' in guard) {
    return pathExists(guard.pathExists);
  }
  if ('commandOutputMatches' in guard) {
    const { argv, exact, contains } = guard.commandOutputMatches;
    if (exact === undefined && contains === undefined) {
      throw new ProvisioningError(
        'commandOutputMatches guard requires exact or contains.',
      );
    }
    const result = await runsSuccessfully(
      argv,
      'commandOutputMatches',
      context,
      options,
    );
    if (result.code !== 0) return false;
    const stdout = result.stdout.trim();
    if (exact !== undefined && stdout !== exact) return false;
    return contains === undefined || stdout.includes(contains);
  }
  const result = await runsSuccessfully(
    guard.commandSucceeds,
    'commandSucceeds',
    context,
    options,
  );
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

export function scopeFor(bindings: ReadonlyMap<string, string>): CommandScope {
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

/**
 * Seed the scope with the reserved host facts (`home`, `basePath`) and the assets
 * declared in `reads`, so every step's tokens resolve against one map.
 */
export async function readBindings(
  reads: Readonly<Record<string, CommandRead>>,
  context: Context,
): Promise<Map<string, string>> {
  const bindings = new Map<string, string>([
    ['home', context.home],
    ['basePath', context.basePath],
  ]);
  for (const [name, key] of Object.entries(reads)) {
    bindings.set(name, (await context.assets.read(key)).toString().trim());
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
