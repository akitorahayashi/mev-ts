import { assetKeysByPrefix } from '../../assets/registry';
import { fs } from '../../providers/filesystem';
import { asset } from '../../resources/asset';
import { home } from '../../resources/path';
import { target } from '../target';

const dotfiles = ['.zshenv', '.zprofile', '.zshrc'];
const dotfileResources = dotfiles.flatMap((name) => {
  const ref = asset(`shell/global/${name}`);
  return [fs.deployAsset(ref), fs.symlink(ref, home(name))];
});

// Alias fragments mirrored under ~/.mev/alias, sourced recursively by .zshrc.
// The set is derived from the embedded assets so adding a fragment requires no
// change here.
const aliasPrefix = 'shell/global/alias/';
const aliasRefs = assetKeysByPrefix(aliasPrefix).map((key) => asset(key));
const aliasDeploys = aliasRefs.map((ref) => fs.deployAsset(ref));

export const shellTarget = target('shell', {
  description: 'Shell environment, dotfiles, and aliases',
  tags: ['shell'],
  aliases: ['sh'],
  resources: [
    ...dotfileResources,
    ...aliasDeploys,
    fs.linkTree(home('.mev/alias'), aliasRefs, aliasPrefix),
  ],
});
