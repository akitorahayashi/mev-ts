import { editorTarget } from './editor-target';

export const antigravityIdeTarget = editorTarget({
  name: 'antigravity_ide',
  description: 'Antigravity IDE configuration and extensions',
  aliases: ['antigravity-ide', 'agi'],
  cask: 'antigravity-ide',
  extensionCli: 'agy-ide',
  userDir: 'Library/Application Support/Antigravity IDE/User',
});
