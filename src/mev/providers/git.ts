import { join } from 'node:path';
import { ProvisioningError } from '../errors';
import type {
  ApplyResult,
  Context,
  Resource,
  ResourceState,
} from '../resources/model';
import { type HostPath, resolveHostPath } from '../resources/path';

interface ConfigOptions {
  /** Resources that must be applied before this config value is set. */
  readonly after?: readonly Resource[];
}

/**
 * Sets a global git config value to a host path. Reads merge the global scope
 * (so a value supplied by a deployed config file is honored), while writes are
 * pinned to `~/.gitconfig` rather than `git config --global`, which would
 * otherwise follow a managed `~/.config/git/config` symlink and rewrite the
 * deployed asset it points at.
 */
function config(
  name: string,
  value: HostPath,
  options: ConfigOptions = {},
): Resource {
  const dependencies = (options.after ?? []).map((resource) => resource.id);
  return {
    id: `git:config:global:${name}`,
    dependencies,
    concurrencyGroup: 'git',
    async inspect(context: Context): Promise<ResourceState> {
      const desired = resolveHostPath(value, context.home);
      const result = await context.commands.run('git', [
        'config',
        '--global',
        '--get',
        name,
      ]);
      if (result.code !== 0) {
        return { kind: 'missing' };
      }
      const current = result.stdout.trim();
      return current === desired
        ? { kind: 'present' }
        : { kind: 'diverged', detail: current };
    },
    async apply(context: Context): Promise<ApplyResult> {
      const desired = resolveHostPath(value, context.home);
      const file = join(context.home, '.gitconfig');
      const result = await context.commands.run('git', [
        'config',
        '--file',
        file,
        name,
        desired,
      ]);
      if (result.code !== 0) {
        throw new ProvisioningError(
          `git config ${name} failed with code ${result.code}: ${result.stderr || result.stdout || 'unknown error'}`,
        );
      }
      return { detail: `${name}=${desired}` };
    },
  };
}

export const git = {
  config,
};
