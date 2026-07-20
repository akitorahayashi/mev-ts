import type { Installed } from './inventory';
import type { PipxTool } from './manifest';

export function needsReinstall(
  tool: PipxTool,
  installed: Installed | undefined,
): boolean {
  if (!installed) return true;
  if (tool.version && tool.version !== installed.version) return true;
  if (tool.install_spec && tool.install_spec !== installed.packageOrUrl)
    return true;
  return false;
}

export function installSpec(tool: PipxTool): string {
  if (tool.install_spec) return tool.install_spec;
  return tool.version ? `${tool.package}==${tool.version}` : tool.package;
}

export function shouldInject(
  tool: PipxTool,
  installed: Installed | undefined,
  justInstalled: boolean,
): boolean {
  if (!tool.inject || tool.inject.length === 0) return false;
  if (justInstalled) return true;
  const have = installed?.dependencies ?? [];
  return tool.inject.some((dep) => !have.includes(dep));
}

export function shouldPostInstall(
  tool: PipxTool,
  justInstalled: boolean,
  justInjected: boolean,
): boolean {
  if (!tool.post_install) return false;
  return justInstalled || justInjected;
}
