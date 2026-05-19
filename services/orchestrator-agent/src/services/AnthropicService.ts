import { AnthropicService as SharedAnthropicService } from '@itinera/shared';
import { config } from '@/config';

export type { CompletionResult } from '@itinera/shared';

export class AnthropicService extends SharedAnthropicService {
  constructor() {
    super(config.ANTHROPIC_API_KEY, config.ANTHROPIC_MODEL);
  }
}
