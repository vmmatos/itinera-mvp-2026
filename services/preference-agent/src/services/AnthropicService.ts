import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { BaseService } from '@itinera/shared';
import { config } from '@/config';

const MODEL = 'claude-sonnet-4-20250514';

interface CompletionResult {
  content: string;
  latencyMs: number;
  tokensUsed: number;
}

export class AnthropicService extends BaseService {
  private readonly client: Anthropic;

  constructor() {
    super('anthropic-service');
    this.client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  }

  async complete(systemPrompt: string, messages: MessageParam[]): Promise<CompletionResult> {
    const startMs = Date.now();

    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: systemPrompt,
      messages,
    });

    const latencyMs = Date.now() - startMs;
    const tokensUsed = response.usage.input_tokens + response.usage.output_tokens;

    const firstBlock = response.content[0];
    const content = firstBlock?.type === 'text' ? firstBlock.text : '';

    this.logger.debug('Anthropic call complete', {
      model: MODEL,
      latencyMs,
      tokensUsed,
      stopReason: response.stop_reason,
    });

    return { content, latencyMs, tokensUsed };
  }
}
