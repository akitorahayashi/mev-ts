import { asset } from '../../assets/ref';
import { home } from '../../host/path';
import { link } from '../activation';
import { target } from '../target';

export const herdrTarget = target('herdr', {
  description: 'Herdr terminal workspace and agent manager',
  aliases: ['hd'],
  role: 'herdr',
  packages: { formulae: ['herdr'] },
  activations: [
    link(asset('herdr/global/config.toml'), home('.config/herdr/config.toml')),
  ],
});
