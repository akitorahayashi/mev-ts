import { expect } from 'bun:test';
import type { PluginActivity } from '../../src/agent-plugin/activity';
import {
  createPluginClients,
  type MarketplaceRemotes,
  type RegistrationCache,
} from '../../src/agent-plugin/client';
import { ProvisioningError } from '../../src/errors';
import { parseRepository } from '../../src/github/repository';
import { fail, ok } from '../fixtures/fake-command-runner';
import { recordingContext } from '../fixtures/fake-context';
import { sandboxedTest } from '../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('plugin-client-');

for (const client of ['claude', 'codex'] as const) {
  sandboxTest(
    `${client} reports running operations rather than queued mutations, including failures`,
    async (home) => {
      const started = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const activities: PluginActivity[] = [];
      const { context } = recordingContext({
        home,
        respond: async (_command, args) => {
          if (args.includes('first@example')) {
            started.resolve();
            await release.promise;
            return fail('upgrade refused');
          }
          return ok('{}');
        },
      });
      const ops = createPluginClients((activity) => activities.push(activity))[
        client
      ];
      const results = Promise.allSettled([
        ops.upgradePlugin('first@example', context),
        ops.enablePlugin('second@example', context),
      ]);
      try {
        await started.promise;
        expect(activities).toHaveLength(1);
        expect(activities[0]).toMatchObject({
          client,
          action: 'upgrade',
          subject: 'first@example',
          state: 'started',
        });
      } finally {
        release.resolve();
      }
      expect((await results).map(({ status }) => status)).toEqual([
        'rejected',
        'fulfilled',
      ]);
      expect(
        activities.map(({ action, state, subject }) => ({
          action,
          state,
          subject,
        })),
      ).toEqual([
        { action: 'upgrade', state: 'started', subject: 'first@example' },
        { action: 'upgrade', state: 'finished', subject: 'first@example' },
        { action: 'enable', state: 'started', subject: 'second@example' },
        { action: 'enable', state: 'finished', subject: 'second@example' },
      ]);
      expect(activities[0]?.id).toBe(activities[1]?.id);
      expect(activities[2]?.id).toBe(activities[3]?.id);
      expect(activities[0]?.id).not.toBe(activities[2]?.id);
    },
  );
}

for (const [client, ops] of Object.entries(createPluginClients())) {
  sandboxTest(
    `serializes every ${client} mutation through completion`,
    async (home) => {
      let active = 0;
      let peak = 0;
      let replacing = false;
      let interleaved = false;
      const { context } = recordingContext({
        home,
        respond: async (_command, args, options) => {
          expect(options?.timeoutMs).toBeGreaterThan(0);
          expect(options?.env?.['GIT_TERMINAL_PROMPT']).toBe('0');
          expect(options?.env?.['GIT_SSH_COMMAND']).toContain('BatchMode=yes');
          expect(options?.env?.['GIT_SSH_COMMAND']).toContain(
            'StrictHostKeyChecking=yes',
          );
          expect(options?.env?.['GIT_SSH_COMMAND']).toMatch(
            /ConnectTimeout=[1-9]\d*/,
          );
          expect(options?.env?.['SSH_ASKPASS_REQUIRE']).toBe('never');
          if (
            args[1] === 'marketplace' &&
            args[2] === 'remove' &&
            args[3] === 'example'
          ) {
            replacing = true;
          } else if (args[1] === 'marketplace' && args[2] === 'add') {
            replacing = false;
          } else if (replacing) {
            interleaved = true;
          }
          active += 1;
          peak = Math.max(peak, active);
          try {
            await new Promise<void>((resolve) => setImmediate(resolve));
            return ok(JSON.stringify({ alreadyAdded: false }));
          } finally {
            active -= 1;
          }
        },
      });
      const remotes: MarketplaceRemotes = new Map([
        [
          'example',
          { url: 'git@old-host:akitorahayashi/example.git', ref: 'main' },
        ],
      ]);
      const cache: RegistrationCache = {
        current: async () => remotes,
        record: (name, registration) => {
          remotes.set(name, registration);
        },
        forget: (name) => {
          remotes.delete(name);
        },
      };

      await Promise.all([
        ops.ensureMarketplace(
          'example',
          parseRepository('akitorahayashi/example', 'test repository'),
          'git@github.com:akitorahayashi/example.git',
          context,
          cache,
        ),
        ops.installPlugin('installed@example', context),
        ops.enablePlugin('enabled@example', context),
        ops.upgradePlugin('upgraded@example', context),
        ops.uninstallPlugin('removed@example', context),
        ops.removeMarketplace('other', context),
      ]);

      expect(peak).toBe(1);
      expect(active).toBe(0);
      expect(interleaved).toBe(false);
      expect(replacing).toBe(false);
      expect(remotes.get('example')?.url).toBe(
        'git@github.com:akitorahayashi/example.git',
      );
    },
  );
}

sandboxTest(
  'a blocked client mutation leaves other clients and inventories independent',
  async (home) => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const { context } = recordingContext({
      home,
      respond: async (command, args) => {
        if (command === 'claude' && args[1] === 'install') {
          started.resolve();
          await release.promise;
        }
        if (command === 'claude' && args[1] === 'list') return ok('[]');
        return ok('{}');
      },
    });
    const clients = createPluginClients();
    const mutation = clients.claude.installPlugin('example@example', context);

    try {
      await started.promise;
      await clients.codex.installPlugin('example@example', context);
      expect(await clients.claude.listPlugins(context)).toEqual(new Map());
    } finally {
      release.resolve();
      await mutation;
    }
  },
);

sandboxTest(
  'a rejected mutation reports its failure and releases the client queue',
  async (home) => {
    const { context } = recordingContext({
      home,
      respond: (_command, args) =>
        args[1] === 'install' ? fail('install refused') : ok(),
    });
    const ops = createPluginClients().claude;
    const results = await Promise.allSettled([
      ops.installPlugin('example@example', context),
      ops.enablePlugin('other@example', context),
    ]);

    expect(results[0]?.status).toBe('rejected');
    if (results[0]?.status === 'rejected') {
      expect(results[0].reason).toBeInstanceOf(ProvisioningError);
      expect(results[0].reason.message).toContain('install refused');
    }
    expect(results[1]?.status).toBe('fulfilled');
  },
);
