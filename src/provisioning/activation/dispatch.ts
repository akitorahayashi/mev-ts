import type { Context } from '../../host/context';
import { describeAgentPlugins, runAgentPlugins } from './agent-plugins';
import {
  describeCoderAgents,
  describeCoderSkills,
  runCoderAgents,
  runCoderSkills,
} from './coder';
import { describeCodexConfig, runCodexConfig } from './codex-config';
import { describeCommand, runCommandActivation } from './command';
import type {
  Activation,
  ActivationReport,
  ActivationRunOptions,
  Described,
} from './contract';
import { describeDefaults, runDefaults } from './defaults';
import { describeDuti, runDuti } from './duti';
import { describeExtensions, runExtensions } from './extensions';
import {
  describeMaterializedFile,
  runMaterializedFile,
} from './materialized-file';
import { describePipx, runPipx } from './pipx';
import { describePnpm, runPnpm } from './pnpm';
import { describeRelease, runRelease } from './release';
import {
  describeRemoteInstaller,
  runRemoteInstaller,
} from './remote-installer';
import { describeFile, describeTree, runFile, runTree } from './symlink';
import { describeZedSettings, runZedSettings } from './zed';

/** Stable, home-independent description of an activation's verb and endpoints. */
export function describeActivation(activation: Activation): Described {
  switch (activation.kind) {
    case 'file':
      return describeFile(activation);
    case 'materializedFile':
      return describeMaterializedFile(activation);
    case 'tree':
      return describeTree(activation);
    case 'defaults':
      return describeDefaults(activation);
    case 'duti':
      return describeDuti(activation);
    case 'pipx':
      return describePipx(activation);
    case 'pnpm':
      return describePnpm(activation);
    case 'editorExtensions':
      return describeExtensions(activation);
    case 'coderAgents':
      return describeCoderAgents(activation);
    case 'coderSkills':
      return describeCoderSkills(activation);
    case 'agentPlugins':
      return describeAgentPlugins(activation);
    case 'zedSettings':
      return describeZedSettings(activation);
    case 'codexConfig':
      return describeCodexConfig(activation);
    case 'command':
      return describeCommand(activation);
    case 'remoteInstaller':
      return describeRemoteInstaller(activation);
    case 'release':
      return describeRelease(activation);
  }
}

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

export function runActivation(
  activation: Activation,
  context: Context,
  options: ActivationRunOptions = { update: false },
): Promise<ActivationReport> {
  switch (activation.kind) {
    case 'file':
      return runFile(activation, context);
    case 'materializedFile':
      return runMaterializedFile(activation, context);
    case 'tree':
      return runTree(activation, context);
    case 'defaults':
      return runDefaults(activation, context);
    case 'duti':
      return runDuti(activation, context);
    case 'pipx':
      return runPipx(activation, context, options);
    case 'pnpm':
      return runPnpm(activation, context, options);
    case 'editorExtensions':
      return runExtensions(activation, context);
    case 'coderAgents':
      return runCoderAgents(activation, context);
    case 'coderSkills':
      return runCoderSkills(activation, context);
    case 'agentPlugins':
      return runAgentPlugins(activation, context, options);
    case 'zedSettings':
      return runZedSettings(activation, context);
    case 'codexConfig':
      return runCodexConfig(activation, context);
    case 'command':
      return runCommandActivation(activation, context);
    case 'remoteInstaller':
      return runRemoteInstaller(activation, context);
    case 'release':
      return runRelease(activation, context, options);
  }
}
