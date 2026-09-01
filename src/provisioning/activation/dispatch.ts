import type { Context } from '../../host/context';
import type {
  Activation,
  ActivationDescription,
  ActivationReport,
  ActivationRunOptions,
} from './contract';
import { handlerFor } from './kinds';
import { activationReport } from './reconcile';

export function describeActivation(
  activation: Activation,
): ActivationDescription {
  return handlerFor(activation).describe(activation);
}

export function blockedReport(
  activation: Activation,
  reason?: string,
): ActivationReport {
  const description = describeActivation(activation);
  return activationReport(description, [
    {
      label: description.subject,
      status: 'blocked',
      reason: reason ?? 'A previous resource failed.',
    },
  ]);
}

export function runActivation(
  activation: Activation,
  context: Context,
  options: ActivationRunOptions = { upgrade: false },
): Promise<ActivationReport> {
  return handlerFor(activation).run(activation, context, options);
}
