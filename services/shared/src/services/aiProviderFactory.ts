import type { IAIProvider } from '../types/aiProvider';
import { AnthropicService } from './AnthropicService';

export type AIProviderType = 'anthropic';

export function createAIProvider(type: AIProviderType, apiKey: string, model: string): IAIProvider {
  switch (type) {
    case 'anthropic':
      return new AnthropicService(apiKey, model);
    default: {
      const exhaustive: never = type;
      throw new Error(`Unknown AI provider: ${String(exhaustive)}`);
    }
  }
}
