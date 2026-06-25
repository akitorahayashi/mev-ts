export { runCommand } from './command';
export type {
  Activation,
  ActivationReport,
  ActivationStatus,
  ChangedWhen,
  CommandScope,
  CommandStep,
  StepGuard,
  StepReport,
  Verb,
} from './contract';
export { applyDefaults } from './defaults';
export { blockedReport, describeActivation, runActivation } from './dispatch';
export { link, linkTree } from './symlink';
