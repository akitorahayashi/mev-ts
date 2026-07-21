export { brewPath, brewPrefixCapture } from './brew-path';
export { coderAgents, coderAgentsConfigAssets, coderSkills } from './coder';
export { bindCommandRead, commandReadKey, runCommand } from './command';
export type {
  Activation,
  ActivationReport,
  ActivationStatus,
  ChangedWhen,
  CommandArg,
  CommandEnvValue,
  CommandStep,
  Described,
  StepGuard,
  StepReport,
  Verb,
} from './contract';
export {
  applyDefaults,
  applyDefaultsTree,
  defaultsConfigAssets,
} from './defaults';
export { blockedReport, describeActivation, runActivation } from './dispatch';
export { applyDuti, dutiConfigAssets } from './duti';
export { extensionsConfigAssets, installExtensions } from './extensions';
export { applyPipx, pipxConfigAssets } from './pipx';
export { releaseBinaries, releaseConfigAssets } from './release';
export { remoteInstaller } from './remote-installer';
export { link, linkTree, migrateLegacySymlinks } from './symlink';
export { versionCheckStep } from './version-check';
export { zedSettings, zedSettingsConfigAssets } from './zed';
