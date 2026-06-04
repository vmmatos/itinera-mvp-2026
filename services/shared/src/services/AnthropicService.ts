import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { BaseService } from './BaseService';

export interface CompletionResult {
  content: string;
  latencyMs: number;
  tokensUsed: number;
}

export class AnthropicService extends BaseService {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    super('anthropic-service');
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async complete(systemPrompt: string, messages: MessageParam[]): Promise<CompletionResult> {
    const MAX_RETRIES = 3;
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this.callOnce(systemPrompt, messages);
      } catch (err: unknown) {
        lastError = err;
        const isLast = attempt === MAX_RETRIES;
        if (!this.isRetryable(err) || isLast) break;

        const delayMs = 1000 * 2 ** (attempt - 1);
        this.logger.warn('Anthropic call failed, retrying', { attempt, delayMs, error: String(err) });
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }
    }

    this.logger.error('Anthropic call failed', { error: String(lastError) });
    throw lastError;
  }

  private async callOnce(
    systemPrompt: string,
    messages: MessageParam[],
  ): Promise<CompletionResult> {
    const startMs = Date.now();

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: systemPrompt,
      messages,
    });

    const latencyMs = Date.now() - startMs;
    const tokensUsed = response.usage.input_tokens + response.usage.output_tokens;
    const firstBlock = response.content[0];
    const content = firstBlock?.type === 'text' ? firstBlock.text : '';

    this.logger.debug('Anthropic call complete', {
      model: this.model,
      latencyMs,
      tokensUsed,
      stopReason: response.stop_reason,
    });

    return { content, latencyMs, tokensUsed };
  }

  private isRetryable(err: unknown): boolean {
    if (err instanceof Error) {
      const statusErr = err as { status?: number };
      if (typeof statusErr.status === 'number') {
        return statusErr.status === 429 || statusErr.status >= 500;
      }
    }
    return false;
  }
}
