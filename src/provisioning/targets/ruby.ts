import { brewPath, brewPrefixCapture, runCommand } from '../activation';
import { target } from '../target';

// rbenv compiles Ruby from source, so the build must see Homebrew's OpenSSL.
// `brew --prefix` (universal) and `brew --prefix openssl@3` (keg) are captured
// once, then fed into PATH and RUBY_CONFIGURE_OPTS for the install step.
export const rubyTarget = target('ruby', {
  description: 'Ruby toolchain via rbenv with bundler',
  aliases: ['rb'],
  role: 'ruby',
  packages: { formulae: ['openssl@3', 'rbenv', 'ruby-build'] },
  activations: [
    runCommand({
      label: 'ruby toolchain',
      reads: { version: 'ruby/.ruby-version' },
      steps: [
        brewPrefixCapture(),
        {
          label: 'openssl prefix',
          argv: ['brew', '--prefix', 'openssl@3'],
          capture: 'opensslPrefix',
          changedWhen: 'never',
        },
        {
          label: 'rbenv install',
          argv: ['rbenv', 'install', { ref: 'version' }, '--skip-existing'],
          skipIf: {
            pathExists: {
              concat: [
                { ref: 'home' },
                '/.rbenv/versions/',
                { ref: 'version' },
              ],
            },
          },
          env: {
            ...brewPath(),
            RUBY_CONFIGURE_OPTS: {
              concat: ['--with-openssl-dir=', { ref: 'opensslPrefix' }],
            },
          },
        },
        {
          label: 'rbenv global',
          argv: ['rbenv', 'global', { ref: 'version' }],
          env: brewPath(),
        },
        {
          label: 'rbenv rehash',
          argv: ['rbenv', 'rehash'],
          env: brewPath(),
        },
        {
          label: 'gem install bundler',
          argv: ['gem', 'install', 'bundler', '-v', '2.5.22', '--no-document'],
          skipIf: {
            commandSucceeds: ['gem', 'list', '-i', 'bundler', '-v', '2.5.22'],
          },
          // rbenv shims must precede brew's bin so the freshly installed ruby's
          // gem is used, so this prepends shims to the shared brew PATH.
          env: {
            PATH: {
              pathList: [
                { concat: [{ ref: 'home' }, '/.rbenv/shims'] },
                { concat: [{ ref: 'brewPrefix' }, '/bin'] },
                { ref: 'basePath' },
              ],
            },
          },
        },
      ],
    }),
  ],
});
