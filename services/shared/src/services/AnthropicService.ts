import Anthropic from '@anthropic-ai/sdk';
import { BaseService } from './BaseService';
import type { AIMessage, CompletionOptions, CompletionResult, IAIProvider } from '../types/aiProvider';

export type { CompletionResult } from '../types/aiProvider';

const DEFAULT_MAX_TOKENS = 4096;

export class AnthropicService extends BaseService implements IAIProvider {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    super('anthropic-service');
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async complete(
    systemPrompt: string,
    messages: AIMessage[],
    options?: CompletionOptions,
  ): Promise<CompletionResult> {
    const MAX_RETRIES = 3;
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this.callOnce(systemPrompt, messages, options);
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
    messages: AIMessage[],
    options?: CompletionOptions,
  ): Promise<CompletionResult> {
    const startMs = Date.now();

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: systemPrompt,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });

    const latencyMs = Date.now() - startMs;
    const tokensUsed = response.usage.input_tokens + response.usage.output_tokens;
    const firstBlock = response.content[0];
    const content = firstBlock?.type === 'text' ? firstBlock.text : '';

    // Truncated output produces invalid JSON downstream — make it loud.
    if (response.stop_reason === 'max_tokens') {
      this.logger.warn('Anthropic response hit max_tokens — output truncated', {
        model: this.model,
        maxTokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
        tokensUsed,
      });
    }

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
