import { applyHuggingfaceModels } from '../activation';
import { target } from '../target';

export const hfTarget = target('hf', {
  description: 'Hugging Face model cache',
  role: 'hf',
  optional: true,
  activations: [applyHuggingfaceModels('hf/models.yml')],
});
