import { join } from 'node:path';
import type { CommandOptions } from '../host/command';
import { runProcessStep } from '../host/command-run';
import type { Context } from '../host/context';
import type { PostInstall } from './manifest';

export async function uninstall(
  context: Context,
  options: CommandOptions,
  pkg: string,
): Promise<void> {
  await runProcessStep(
    context.commands,
    'pipx',
    ['uninstall', pkg],
    `pipx uninstall failed for ${pkg}`,
    options,
  );
}

export async function install(
  context: Context,
  options: CommandOptions,
  spec: string,
): Promise<void> {
  await runProcessStep(
    context.commands,
    'pipx',
    ['install', spec],
    `pipx install failed for ${spec}`,
    options,
  );
}

export async function inject(
  context: Context,
  options: CommandOptions,
  pkg: string,
  deps: readonly string[],
): Promise<void> {
  await runProcessStep(
    context.commands,
    'pipx',
    ['inject', pkg, ...deps],
    `pipx inject failed for ${pkg}`,
    options,
  );
}

export async function postInstall(
  context: Context,
  options: CommandOptions,
  venvs: string,
  pkg: string,
  post: PostInstall,
): Promise<void> {
  const bin = join(venvs, pkg, 'bin', post.bin);
  await runProcessStep(
    context.commands,
    bin,
    post.args ?? [],
    `pipx post-install failed for ${pkg}`,
    options,
  );
}
