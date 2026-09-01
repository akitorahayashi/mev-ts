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
      reads: {
        version: 'ruby/.ruby-version',
        bundler: 'ruby/.bundler-version',
      },
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
          report: {
            kind: 'reconcile',
            subject: 'Ruby runtime',
            changed: { concat: ['installed ', { ref: 'version' }] },
            unchanged: { concat: [{ ref: 'version' }, ' already installed'] },
          },
        },
        {
          label: 'rbenv global',
          argv: ['rbenv', 'global', { ref: 'version' }],
          skipIf: {
            commandOutputMatches: {
              argv: ['rbenv', 'global'],
              exact: { ref: 'version' },
            },
          },
          report: {
            kind: 'reconcile',
            subject: 'default Ruby runtime',
            changed: { concat: ['set to ', { ref: 'version' }] },
            unchanged: { concat: [{ ref: 'version' }, ' already selected'] },
          },
          env: brewPath(),
        },
        {
          label: 'rbenv rehash',
          argv: ['rbenv', 'rehash'],
          report: {
            kind: 'apply',
            subject: 'Ruby shims',
            detail: 'refreshed',
          },
          env: brewPath(),
        },
        {
          label: 'gem install bundler',
          argv: [
            'gem',
            'install',
            'bundler',
            '-v',
            { ref: 'bundler' },
            '--no-document',
          ],
          skipIf: {
            commandSucceeds: [
              'gem',
              'list',
              '-i',
              'bundler',
              '-v',
              { ref: 'bundler' },
            ],
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
          report: {
            kind: 'reconcile',
            subject: 'Bundler',
            changed: { concat: ['installed ', { ref: 'bundler' }] },
            unchanged: { concat: [{ ref: 'bundler' }, ' already installed'] },
          },
        },
      ],
    }),
  ],
});
