import { needsInstall, shouldUpgrade as upgradesPin } from '../version-pin';
import type { Installed } from './inventory';
import { latestVersion, type PipxTool } from './manifest';

export function needsReinstall(
  tool: PipxTool,
  installed: Installed | undefined,
): boolean {
  return needsInstall(tool.version, installed?.version);
}

export function installSpec(tool: PipxTool): string {
  return tool.version === latestVersion
    ? tool.package
    : `${tool.package}==${tool.version}`;
}

export function shouldUpgrade(
  tool: PipxTool,
  installed: Installed | undefined,
  upgrade: boolean,
): boolean {
  return upgradesPin(tool.version, installed !== undefined, upgrade);
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
  justUpgraded: boolean,
): boolean {
  if (!tool.post_install) return false;
  return justInstalled || justInjected || justUpgraded;
}
