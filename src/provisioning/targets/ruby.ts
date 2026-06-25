import type { CommandScope } from '../activation';
import { runCommand } from '../activation';
import { target } from '../target';

// rbenv compiles Ruby from source, so the build must see Homebrew's OpenSSL.
// `brew --prefix` (universal) and `brew --prefix openssl@3` (keg) are captured
// once, then fed into PATH and RUBY_CONFIGURE_OPTS for the install step.
const brewPath = (s: CommandScope) => ({
  PATH: `${s.ref('brewPrefix')}/bin:${s.basePath}`,
});

export const rubyTarget = target('ruby', {
  description: 'Ruby toolchain via rbenv with bundler',
  aliases: ['rb'],
  role: 'ruby',
  packages: { formulae: ['openssl@3', 'rbenv', 'ruby-build'] },
  activations: [
    runCommand({
      label: 'ruby toolchain',
      reads: { version: 'ruby/global/.ruby-version' },
      steps: [
        {
          label: 'brew prefix',
          argv: () => ['brew', '--prefix'],
          capture: 'brewPrefix',
          changedWhen: 'never',
        },
        {
          label: 'openssl prefix',
          argv: () => ['brew', '--prefix', 'openssl@3'],
          capture: 'opensslPrefix',
          changedWhen: 'never',
        },
        {
          label: 'rbenv install',
          argv: (s) => [
            'rbenv',
            'install',
            s.ref('version'),
            '--skip-existing',
          ],
          skipIf: (s) => ({
            pathExists: `${s.home}/.rbenv/versions/${s.ref('version')}`,
          }),
          env: (s) => ({
            PATH: `${s.ref('brewPrefix')}/bin:${s.basePath}`,
            RUBY_CONFIGURE_OPTS: `--with-openssl-dir=${s.ref('opensslPrefix')}`,
          }),
        },
        {
          label: 'rbenv global',
          argv: (s) => ['rbenv', 'global', s.ref('version')],
          env: brewPath,
        },
        {
          label: 'rbenv rehash',
          argv: () => ['rbenv', 'rehash'],
          env: brewPath,
        },
        {
          label: 'gem install bundler',
          argv: () => [
            'gem',
            'install',
            'bundler',
            '-v',
            '2.5.22',
            '--no-document',
          ],
          skipIf: () => ({
            commandSucceeds: ['gem', 'list', '-i', 'bundler', '-v', '2.5.22'],
          }),
          env: (s) => ({
            PATH: `${s.home}/.rbenv/shims:${s.ref('brewPrefix')}/bin:${s.basePath}`,
          }),
        },
      ],
    }),
  ],
});
