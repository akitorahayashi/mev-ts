import { editorTarget } from './editor-target';

export const vscodeTarget = editorTarget({
  name: 'vscode',
  description: 'Visual Studio Code configuration and extensions',
  aliases: ['co'],
  cask: 'visual-studio-code',
  extensionCli: 'code',
  userDir: 'Library/Application Support/Code/User',
});
