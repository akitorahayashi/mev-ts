import type { Context } from '../../host/context';
import {
  describeCoderAgents,
  describeCoderSkills,
  runCoderAgents,
  runCoderSkills,
} from './coder';
import { describeCommand, runCommandActivation } from './command';
import type { Activation, ActivationReport, Described } from './contract';
import { describeDefaults, runDefaults } from './defaults';
import { describeDuti, runDuti } from './duti';
import { describeExtensions, runExtensions } from './extensions';
import { describePipx, runPipx } from './pipx';
import { describeFile, describeTree, runFile, runTree } from './symlink';

/** Stable, home-independent description of an activation's verb and endpoints. */
export function describeActivation(activation: Activation): Described {
  switch (activation.kind) {
    case 'file':
      return describeFile(activation);
    case 'tree':
      return describeTree(activation);
    case 'defaults':
      return describeDefaults(activation);
    case 'duti':
      return describeDuti(activation);
    case 'pipx':
      return describePipx(activation);
    case 'editorExtensions':
      return describeExtensions(activation);
    case 'coderAgents':
      return describeCoderAgents(activation);
    case 'coderSkills':
      return describeCoderSkills(activation);
    case 'command':
      return describeCommand(activation);
  }
}

/** Report for an activation whose role deploy failed and so cannot proceed. */
export function blockedReport(activation: Activation): ActivationReport {
  return { ...describeActivation(activation), status: 'blocked' };
}

/**
 * Inspect an activation and, unless `plan` is set, apply it. Returns a report
 * whose status drives both the exit code and the per-tag execution log.
 */
export function runActivation(
  activation: Activation,
  context: Context,
  plan: boolean,
): Promise<ActivationReport> {
  switch (activation.kind) {
    case 'file':
      return runFile(activation, context, plan);
    case 'tree':
      return runTree(activation, context, plan);
    case 'defaults':
      return runDefaults(activation, context, plan);
    case 'duti':
      return runDuti(activation, context, plan);
    case 'pipx':
      return runPipx(activation, context, plan);
    case 'editorExtensions':
      return runExtensions(activation, context, plan);
    case 'coderAgents':
      return runCoderAgents(activation, context, plan);
    case 'coderSkills':
      return runCoderSkills(activation, context, plan);
    case 'command':
      return runCommandActivation(activation, context, plan);
  }
}
