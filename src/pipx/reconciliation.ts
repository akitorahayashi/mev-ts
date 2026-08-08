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

/**
 * Whether update mode re-resolves this tool against the latest release.
 * `version` is the only pin vocabulary, so a pinned tool is never upgraded; an
 * `install_spec` without `version` is latest-assumed because pipx upgrade
 * re-resolves the recorded spec.
 */
export function shouldUpgrade(
  tool: PipxTool,
  installed: Installed | undefined,
  update: boolean,
): boolean {
  return (
    update &&
    installed !== undefined &&
    !needsReinstall(tool, installed) &&
    !tool.version
  );
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
