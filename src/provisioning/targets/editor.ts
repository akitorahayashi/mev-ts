import { asset } from '../../assets/ref';
import { home } from '../../host/path';
import { declaredKeys, installExtensions, link } from '../activation';
import { type Target, target } from '../target';

/**
 * A VS Code-family editor target: enforce the declared `settings.json` keys, link
 * `keybindings.json` into the app's User directory, and install the extension
 * set. The role and asset prefix are the target name; assets live under `<name>/`.
 */
export interface EditorTargetSpec {
  readonly name: string;
  readonly description: string;
  readonly aliases: readonly string[];
  readonly cask: string;
  readonly extensionCli: string;
  readonly userDir: string;
  readonly optional?: boolean;
}

export function editorTarget(spec: EditorTargetSpec): Target {
  return target(spec.name, {
    description: spec.description,
    aliases: [...spec.aliases],
    role: spec.name,
    optional: spec.optional,
    packages: { casks: [spec.cask] },
    activations: [
      // Merged, not linked: the editor rewrites settings.json in place when a
      // setting is toggled through its UI, normalizing values as it goes, so a
      // symlink into the deploy store would route those writes into the deployed
      // role and every deploy would revert them. keybindings.json is a top-level
      // array with no per-key merge, and mev owns it outright, so it stays a link.
      declaredKeys(
        asset(`${spec.name}/settings.json`),
        home(`${spec.userDir}/settings.json`),
        'json',
      ),
      link(
        asset(`${spec.name}/keybindings.json`),
        home(`${spec.userDir}/keybindings.json`),
      ),
      installExtensions(spec.extensionCli, `${spec.name}/extensions.json`),
    ],
  });
}
