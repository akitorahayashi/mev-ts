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
import { describeRelease, runRelease } from './release';
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
    case 'release':
      return describeRelease();
  }
}

/** Report for an activation whose prerequisites failed and so cannot proceed. */
export function blockedReport(
  activation: Activation,
  reason?: string,
): ActivationReport {
  return {
    ...describeActivation(activation),
    status: 'blocked',
    error: reason,
  };
}

/** Apply an activation and return the report that drives the execution log. */
export function runActivation(
  activation: Activation,
  context: Context,
): Promise<ActivationReport> {
  switch (activation.kind) {
    case 'file':
      return runFile(activation, context);
    case 'tree':
      return runTree(activation, context);
    case 'defaults':
      return runDefaults(activation, context);
    case 'duti':
      return runDuti(activation, context);
    case 'pipx':
      return runPipx(activation, context);
    case 'editorExtensions':
      return runExtensions(activation, context);
    case 'coderAgents':
      return runCoderAgents(activation, context);
    case 'coderSkills':
      return runCoderSkills(activation, context);
    case 'command':
      return runCommandActivation(activation, context);
    case 'release':
      return runRelease(activation, context);
  }
}
