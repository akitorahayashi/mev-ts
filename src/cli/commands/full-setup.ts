import { type Context, createContext } from '../../host/context';
import { fullSetupTargets } from '../../provisioning/registry';
import type { Target } from '../../provisioning/target';

export function prepareFullSetup(): {
  readonly context: Context;
  readonly targets: readonly Target[];
} {
  return { context: createContext(), targets: fullSetupTargets() };
}
