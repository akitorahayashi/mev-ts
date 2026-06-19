import {
  type GreetingLanguage,
  resolveGreetingLanguage,
} from '../greetings/language';
import { composeGreetingMessage } from '../greetings/message';

export interface GreetApplicationRequest {
  lang?: string;
  name: string;
}

export interface GreetApplicationResult {
  lang: GreetingLanguage;
  message: string;
}

export function greet(
  request: GreetApplicationRequest,
): GreetApplicationResult {
  const lang = resolveGreetingLanguage(request.lang);

  return {
    lang,
    message: composeGreetingMessage({
      lang,
      name: request.name,
    }),
  };
}
