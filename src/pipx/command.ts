import { join } from 'node:path';
import { ProvisioningError } from '../errors';
import { type CommandOptions, formatCommandFailure } from '../host/command';
import type { Context } from '../host/context';
import type { PostInstall } from './manifest';

export async function uninstall(
  context: Context,
  options: CommandOptions,
  pkg: string,
): Promise<void> {
  const result = await context.commands.run(
    'pipx',
    ['uninstall', pkg],
    options,
  );
  if (result.code !== 0) {
    throw new ProvisioningError(
      formatCommandFailure(`pipx uninstall failed for ${pkg}`, result),
    );
  }
}

export async function install(
  context: Context,
  options: CommandOptions,
  spec: string,
): Promise<void> {
  const result = await context.commands.run('pipx', ['install', spec], options);
  if (result.code !== 0) {
    throw new ProvisioningError(
      formatCommandFailure(`pipx install failed for ${spec}`, result),
    );
  }
}

export async function inject(
  context: Context,
  options: CommandOptions,
  pkg: string,
  deps: readonly string[],
): Promise<void> {
  const result = await context.commands.run(
    'pipx',
    ['inject', pkg, ...deps],
    options,
  );
  if (result.code !== 0) {
    throw new ProvisioningError(
      formatCommandFailure(`pipx inject failed for ${pkg}`, result),
    );
  }
}

export async function postInstall(
  context: Context,
  options: CommandOptions,
  venvs: string,
  pkg: string,
  post: PostInstall,
): Promise<void> {
  const bin = join(venvs, pkg, 'bin', post.bin);
  const result = await context.commands.run(bin, post.args ?? [], options);
  if (result.code !== 0) {
    throw new ProvisioningError(
      formatCommandFailure(`pipx post-install failed for ${pkg}`, result),
    );
  }
}
