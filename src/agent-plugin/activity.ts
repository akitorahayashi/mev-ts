import type { PluginClient } from './catalog';

export type PluginAction =
  | 'check'
  | 'install'
  | 'upgrade'
  | 'enable'
  | 'uninstall'
  | 'register'
  | 'refresh'
  | 'update'
  | 'remove'
  | 'verify';

export interface PluginActivity {
  readonly client: PluginClient;
  readonly id: string;
  readonly action: PluginAction;
  readonly subject: string;
  readonly state: 'started' | 'finished';
}

export function createPluginActivity(
  client: PluginClient,
  observer?: (activity: PluginActivity) => void,
) {
  let sequence = 0;
  return async <T>(
    action: PluginAction,
    subject: string,
    run: () => Promise<T>,
  ): Promise<T> => {
    const activity = { client, id: `${client}:${sequence++}`, action, subject };
    observer?.({ ...activity, state: 'started' });
    try {
      return await run();
    } finally {
      observer?.({ ...activity, state: 'finished' });
    }
  };
}
