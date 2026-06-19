import { GreetingValidationError } from '../errors';
import type { GreetingLanguage } from './language';

export interface GreetingMessageInput {
  lang: GreetingLanguage;
  name: string;
}

export function composeGreetingMessage(input: GreetingMessageInput): string {
  const name = input.name.trim();

  if (name.length === 0) {
    throw new GreetingValidationError('Name is required.');
  }

  switch (input.lang) {
    case 'en':
      return `Hello, ${name}!`;
    case 'ja':
      return `こんにちは、${name}さん！`;
  }
}
