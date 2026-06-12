export interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CompletionResult {
  content: string;
  latencyMs: number;
  tokensUsed: number;
}

export interface IAIProvider {
  complete(systemPrompt: string, messages: AIMessage[]): Promise<CompletionResult>;
}
