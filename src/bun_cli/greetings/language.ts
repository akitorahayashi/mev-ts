import { CommandLineError } from '../errors';

export const greetingLanguages = ['en', 'ja'] as const;

export type GreetingLanguage = (typeof greetingLanguages)[number];
export const defaultGreetingLanguage: GreetingLanguage = 'ja';

export function resolveGreetingLanguage(
  value: string | undefined,
): GreetingLanguage {
  if (!value || value === defaultGreetingLanguage) {
    return defaultGreetingLanguage;
  }

  if (value === 'en') {
    return 'en';
  }

  if (value === 'ja') {
    return 'ja';
  }

  throw new CommandLineError(
    `Unsupported language '${value}'. Expected one of: ${greetingLanguages.join(', ')}.`,
  );
}
