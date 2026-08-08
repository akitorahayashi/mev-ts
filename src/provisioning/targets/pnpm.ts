import { asset } from '../../assets/ref';
import { home } from '../../host/path';
import { applyPnpm, link } from '../activation';
import { target } from '../target';

export const pnpmTarget = target('pnpm', {
  description: 'pnpm global packages',
  aliases: ['pn'],
  role: 'pnpm',
  packages: { formulae: ['pnpm'] },
  activations: [
    link(
      asset('pnpm/config.yaml'),
      home('Library/Preferences/pnpm/config.yaml'),
    ),
    applyPnpm('pnpm/global-packages.yml'),
  ],
});
