import type { CAC } from 'cac';
import { greet } from '../app/greet';
import {
  defaultGreetingLanguage,
  greetingLanguages,
} from '../greetings/language';

interface GreetOptions {
  lang?: string;
}

export function registerGreetCommand(program: CAC): void {
  const languageValues = greetingLanguages.join('|');

  program
    .command('greet <name>', 'Print a greeting for one person.')
    .alias('g')
    .option(
      `--lang <${languageValues}>`,
      `Greeting language. Defaults to ${defaultGreetingLanguage}.`,
    )
    .action((name: string, options: GreetOptions) => {
      const result = greet({
        lang: options.lang,
        name,
      });

      process.stdout.write(`${result.message}\n`);
    });
}
