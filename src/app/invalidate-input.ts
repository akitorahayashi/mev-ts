import { appliedPath, invalidateApplied } from '../provisioning/applied';
import { allTargets } from '../provisioning/registry';
import type { PerMachineInput } from '../provisioning/target';

export async function invalidateInput(
  home: string,
  input: PerMachineInput,
): Promise<void> {
  for (const target of allTargets()) {
    if (target.perMachineInputs.includes(input)) {
      await invalidateApplied(appliedPath(home, target.name));
    }
  }
}
