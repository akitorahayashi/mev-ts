import { errorMessage } from '../../errors';
import type { Context } from '../../host/context';
import {
  type CachedModel,
  ensureModel,
  listCached,
  type ModelAction,
  removeModel,
} from '../../huggingface/cache';
import { type ModelEntry, parseManifest } from '../../huggingface/manifest';
import { reportActivity } from './activity';
import type {
  Activation,
  ActivationActivity,
  ActivationRunOptions,
} from './contract';
import { manifestKind } from './manifest-kind';
import type { ReconcileStep } from './reconcile';

type ModelsActivation = Extract<Activation, { kind: 'huggingfaceModels' }>;

export function applyHuggingfaceModels(configKey: string): Activation {
  return { kind: 'huggingfaceModels', configKey };
}

function modelStep(
  entry: ModelEntry,
  previous: CachedModel | undefined,
  context: Context,
  options: ActivationRunOptions,
): ReconcileStep {
  let active: ActivationActivity | undefined;
  let sequence = 0;
  let phase: ModelAction = 'check';
  const finish = () => {
    const activity = active;
    active = undefined;
    if (activity?.operation) {
      reportActivity(options.onActivity, {
        ...activity,
        operation: { ...activity.operation, state: 'finished' },
      });
    }
  };
  const start = (action: ModelAction) => {
    finish();
    phase = action;
    active = {
      action,
      subject: entry.repo,
      operation: {
        id: `huggingface:${entry.repo}:${sequence++}`,
        group: entry.repo,
        state: 'started',
      },
    };
    reportActivity(options.onActivity, active);
  };
  return {
    async run() {
      try {
        if (entry.action === 'uninstall') {
          start(previous ? 'remove' : 'check');
          return {
            key: entry.repo,
            ...(await removeModel(entry.repo, previous, context)),
          };
        }
        return {
          key: entry.repo,
          ...(await ensureModel(
            entry.repo,
            previous,
            context,
            options.upgrade,
            start,
          )),
        };
      } finally {
        finish();
      }
    },
    onError(error) {
      return {
        key: entry.repo,
        value: phase,
        status: 'failed',
        error: errorMessage(error),
      };
    },
  };
}

export const huggingfaceKind = manifestKind<ModelsActivation, ModelEntry>({
  parse: parseManifest,
  manifestLabel: 'Hugging Face models manifest',
  describe: () => ({
    subject: 'Hugging Face models',
    unchangedCollection: 'Hugging Face models',
  }),
  steps: async (entries, _activation, context, options) => {
    const cached = await listCached(context);
    return entries.map((entry) =>
      modelStep(entry, cached.get(entry.repo), context, options),
    );
  },
});
