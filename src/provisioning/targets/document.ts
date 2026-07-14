import { target } from '../target';

export const documentTarget = target('document', {
  description: 'Document conversion with Pandoc, Poppler, and Google Chrome',
  aliases: ['doc'],
  role: 'document',
  packages: {
    formulae: ['pandoc', 'poppler'],
    casks: ['google-chrome'],
  },
  activations: [],
});
