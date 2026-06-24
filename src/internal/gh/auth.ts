import type { CommandRunner } from '../../host/command';

export async function authStatus(run: CommandRunner): Promise<boolean> {
  const result = await run.run('gh', ['auth', 'status']);
  return result.code === 0;
}
