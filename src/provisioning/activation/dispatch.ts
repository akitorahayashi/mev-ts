import type { Context } from '../../host/context';
import type {
  Activation,
  ActivationReport,
  ActivationRunOptions,
  Described,
} from './contract';
import { handlerFor } from './kinds';

/** Stable, home-independent description of an activation's verb and endpoints. */
export function describeActivation(activation: Activation): Described {
  return handlerFor(activation).describe(activation);
}

export function blockedReport(
  activation: Activation,
  reason?: string,
): ActivationReport {
  return {
    ...describeActivation(activation),
    status: 'blocked',
    error: reason,
  };
}

export function runActivation(
  activation: Activation,
  context: Context,
  options: ActivationRunOptions = { upgrade: false },
): Promise<ActivationReport> {
  return handlerFor(activation).run(activation, context, options);
}
