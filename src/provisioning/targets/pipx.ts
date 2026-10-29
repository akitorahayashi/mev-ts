import { applyPipx } from '../activation';
import { target } from '../target';

export const pipxTarget = target('pipx', {
  description: 'Python applications in isolated environments via pipx',
  aliases: ['px'],
  role: 'pipx',
  activations: [applyPipx('pipx/tools.yml')],
});
