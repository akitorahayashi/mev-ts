import { join } from 'node:path';
import { parsePluginCatalog } from '../../agent-plugin/catalog';
import { parseSectionCatalog, reconcileSections } from '../../coder/catalog';
import { renderConfig } from '../../grove/config';
import type { Context } from '../../host/context';
import { loadToml } from '../../host/toml';
import { parseJsonObject } from '../../zed/settings';
import { describeAgentPlugins, runAgentPlugins } from './agent-plugins';
import {
  describeCoderAgents,
  describeCoderSkills,
  runCoderAgents,
  runCoderSkills,
} from './coder';
import { describeCodexConfig, runCodexConfig } from './codex-config';
import { describeCommand, runCommandActivation } from './command';
import type {
  Activation,
  ActivationReport,
  ActivationRunOptions,
  AssetCheck,
  AssetReference,
  Described,
} from './contract';
import { defaultsKind } from './defaults';
import { dutiKind } from './duti';
import { extensionsKind } from './extensions';
import { describeGroveConfig, runGroveConfig } from './grove-config';
import { pipxKind } from './pipx';
import { pnpmKind } from './pnpm';
import { releaseKind } from './release';
import {
  describeRemoteInstaller,
  runRemoteInstaller,
} from './remote-installer';
import { describeFile, describeTree, runFile, runTree } from './symlink';
import { describeZedSettings, runZedSettings } from './zed';

/**
 * Everything the engine needs to know about one activation kind: how to
 * describe it, how to run it, which embedded assets it references, and which of
 * those are parsed at build time.
 *
 * Methods rather than function properties, so a handler for one member of the
 * union stays assignable to a handler over the union and the dispatch below
 * needs no per-kind cast.
 */
export interface KindHandler<A extends Activation> {
  describe(activation: A): Described;
  run(
    activation: A,
    context: Context,
    options: ActivationRunOptions,
  ): Promise<ActivationReport>;
  /** Every embedded asset the activation names, for the existence invariant. */
  references(activation: A): readonly AssetReference[];
  /** Assets whose content is checked before the binary is built. */
  assetChecks?(activation: A, assets: Context['assets']): readonly AssetCheck[];
}

/**
 * The single per-kind table. Describe, run, asset references, and build-time
 * validation were four parallel tables across dispatch, preflight, and the
 * registry test; adding a kind meant teaching each of them separately, and only
 * the compiler kept them aligned. The mapped type makes an unhandled kind a type
 * error here and nowhere else.
 */
type ActivationKinds = {
  [K in Activation['kind']]: KindHandler<Extract<Activation, { kind: K }>>;
};

const sourceReference = (activation: {
  readonly source: { readonly key: string };
}): readonly AssetReference[] => [{ key: activation.source.key }];

export const activationKinds: ActivationKinds = {
  file: {
    describe: describeFile,
    run: (activation, context) => runFile(activation, context),
    references: sourceReference,
  },
  tree: {
    describe: describeTree,
    run: (activation, context) => runTree(activation, context),
    references: (activation) => [{ prefix: activation.prefix }],
  },
  groveConfig: {
    describe: describeGroveConfig,
    run: (activation, context) => runGroveConfig(activation, context),
    references: sourceReference,
    assetChecks: (activation) => [
      {
        key: activation.source.key,
        // The stock host stands in for the per-machine alias, which is a host
        // fact no build can know.
        parse: (raw, key) => {
          renderConfig(raw, 'github.com', key);
        },
      },
    ],
  },
  codexConfig: {
    describe: describeCodexConfig,
    run: (activation, context) => runCodexConfig(activation, context),
    references: sourceReference,
    assetChecks: (activation) => [
      {
        key: activation.source.key,
        parse: (raw, key) => {
          loadToml(raw, key);
        },
      },
    ],
  },
  defaults: defaultsKind,
  duti: dutiKind,
  pipx: pipxKind,
  pnpm: pnpmKind,
  editorExtensions: extensionsKind,
  release: releaseKind,
  coderAgents: {
    describe: describeCoderAgents,
    run: (activation, context) => runCoderAgents(activation, context),
    references: (activation) => [{ prefix: activation.sectionsPrefix }],
    assetChecks: (activation) => [
      {
        key: join(activation.sectionsPrefix, 'catalog.yml'),
        parse: (raw, key, assets) => {
          const prefix = `${activation.sectionsPrefix}/`;
          const present = assets
            .keysByPrefix(prefix)
            .map((assetKey) => assetKey.slice(prefix.length))
            .filter((name) => name.endsWith('.md') && !name.includes('/'))
            .map((name) => name.slice(0, -'.md'.length));
          reconcileSections(parseSectionCatalog(raw, key), present);
        },
      },
    ],
  },
  coderSkills: {
    describe: describeCoderSkills,
    run: (activation, context) => runCoderSkills(activation, context),
    references: (activation) => [{ prefix: activation.skillsPrefix }],
    // The skills tree is a filesystem-derived catalog with no build-time schema.
  },
  agentPlugins: {
    describe: describeAgentPlugins,
    run: (activation, context, options) =>
      runAgentPlugins(activation, context, options),
    references: (activation) => [{ key: activation.configKey }],
    assetChecks: (activation) => [
      {
        key: activation.configKey,
        parse: (raw, key) => {
          parsePluginCatalog(raw, key);
        },
      },
    ],
  },
  zedSettings: {
    describe: describeZedSettings,
    run: (activation, context) => runZedSettings(activation, context),
    references: (activation) => [
      { key: activation.base.key },
      { prefix: activation.overridesPrefix },
    ],
    assetChecks: (activation, assets) => [
      {
        key: activation.base.key,
        parse: (raw, key) => {
          parseJsonObject(raw, key, 'Zed base settings');
        },
      },
      // Each override fragment is its own document, so each is parsed.
      ...assets.keysByPrefix(`${activation.overridesPrefix}/`).map((key) => ({
        key,
        parse: (raw: string, assetKey: string) => {
          parseJsonObject(raw, assetKey, 'Zed override');
        },
      })),
    ],
  },
  command: {
    describe: describeCommand,
    run: (activation, context) => runCommandActivation(activation, context),
    references: (activation) =>
      Object.values(activation.reads ?? {}).map((key) => ({ key })),
    // A read declares only a key, so the check is existence: an absent key fails
    // the build instead of failing mid-provisioning.
    assetChecks: (activation) =>
      Object.values(activation.reads ?? {}).map((key) => ({ key })),
  },
  remoteInstaller: {
    describe: describeRemoteInstaller,
    run: (activation, context) => runRemoteInstaller(activation, context),
    references: (activation) =>
      Object.values(activation.reads ?? {}).map((key) => ({ key })),
    assetChecks: (activation) =>
      Object.values(activation.reads ?? {}).map((key) => ({ key })),
  },
};

/** The handler for an activation, widened so callers need no per-kind narrowing. */
export function handlerFor(activation: Activation): KindHandler<Activation> {
  return activationKinds[activation.kind];
}
