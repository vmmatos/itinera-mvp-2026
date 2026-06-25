export interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CompletionResult {
  content: string;
  latencyMs: number;
  tokensUsed: number;
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
