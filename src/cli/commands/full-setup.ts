import { type Context, createContext } from '../../host/context';
import { pruneObsoleteDeployState } from '../../provisioning/deploy-store';
import { fullSetupTargets } from '../../provisioning/registry';
import type { Target } from '../../provisioning/target';

/**
 * The prelude `create` and `sync` share: build the live context, prune deploy
 * state for targets no longer in the registry, and resolve the full-environment
 * target set. `make` deliberately omits pruning (it provisions only the named
 * targets), so it does not use this.
 */
export async function prepareFullSetup(
  write: (text: string) => void,
): Promise<{ readonly context: Context; readonly targets: readonly Target[] }> {
  const context = createContext();
  await pruneObsoleteDeployState(context, write);
  return { context, targets: fullSetupTargets() };
}
