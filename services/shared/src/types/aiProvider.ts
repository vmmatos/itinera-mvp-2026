export interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CompletionResult {
  content: string;
  latencyMs: number;
  tokensUsed: number;
  /**
   * True when the provider cut the response off for hitting the output-token limit,
   * so `content` is very likely incomplete/invalid JSON. Provider-agnostic by design —
   * each IAIProvider implementation maps its own native stop/finish reason onto this
   * single boolean (e.g. Anthropic's `stop_reason === 'max_tokens'`, OpenAI's
   * `finish_reason === 'length'`) so callers never need to know which provider is live.
   */
  truncated?: boolean;
}

export interface CompletionOptions {
  /** Max output tokens for this call. Large itinerary JSON needs more than the default. */
  maxTokens?: number;
}

export interface IAIProvider {
  complete(
    systemPrompt: string,
    messages: AIMessage[],
    options?: CompletionOptions,
  ): Promise<CompletionResult>;
}
