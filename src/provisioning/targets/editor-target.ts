import { asset } from '../../assets/ref';
import { home } from '../../host/path';
import { installExtensions, link } from '../activation';
import { type Target, target } from '../target';

/**
 * A VS Code-family editor target: link `settings.json` and `keybindings.json`
 * into the app's User directory and install the extension set. The role and asset
 * prefix are the target name; assets live under `<name>/`.
 */
export interface EditorTargetSpec {
  readonly name: string;
  readonly description: string;
  readonly aliases: readonly string[];
  readonly cask: string;
  readonly extensionCli: string;
  /** The app's User directory, relative to home. */
  readonly userDir: string;
}

export function editorTarget(spec: EditorTargetSpec): Target {
  return target(spec.name, {
    description: spec.description,
    aliases: [...spec.aliases],
    role: spec.name,
    packages: { casks: [spec.cask] },
    activations: [
      link(
        asset(`${spec.name}/settings.json`),
        home(`${spec.userDir}/settings.json`),
      ),
      link(
        asset(`${spec.name}/keybindings.json`),
        home(`${spec.userDir}/keybindings.json`),
      ),
      installExtensions(spec.extensionCli, `${spec.name}/extensions.json`),
    ],
  });
}
