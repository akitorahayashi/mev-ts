export { brewPath, brewPrefixCapture } from './brew-path';
export { coderAgents, coderSkills } from './coder';
export { runCommand } from './command';
export type {
  Activation,
  ActivationReport,
  ActivationStatus,
  ChangedWhen,
  CommandScope,
  CommandStep,
  Described,
  StepGuard,
  StepReport,
  Verb,
} from './contract';
export { applyDefaults } from './defaults';
export { blockedReport, describeActivation, runActivation } from './dispatch';
export { applyDuti } from './duti';
export { installExtensions } from './extensions';
export { applyPipx } from './pipx';
export { releaseBinaries } from './release';
export { link, linkTree } from './symlink';
export { zedSettings } from './zed';
