import type { Installed } from './inventory';
import { latestVersion, type PipxTool } from './manifest';

export function needsReinstall(
  tool: PipxTool,
  installed: Installed | undefined,
): boolean {
  if (!installed) return true;
  return tool.version !== latestVersion && tool.version !== installed.version;
}

export function installSpec(tool: PipxTool): string {
  return tool.version === latestVersion
    ? tool.package
    : `${tool.package}==${tool.version}`;
}

/**
 * Whether update mode re-resolves this tool against the latest release.
 * `latest` is the only latest-assumed vocabulary, so a pinned tool is never
 * upgraded; a pin that diverges from the installed version is a reinstall
 * rather than an upgrade.
 */
export function shouldUpgrade(
  tool: PipxTool,
  installed: Installed | undefined,
  update: boolean,
): boolean {
  return update && installed !== undefined && tool.version === latestVersion;
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
