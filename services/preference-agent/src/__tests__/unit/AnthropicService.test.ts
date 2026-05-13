import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@itinera/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itinera/shared')>();
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  };
});

vi.mock('@/config', () => ({
  config: { 
    ANTHROPIC_API_KEY: 'test-key',
    NODE_ENV: 'test',
    ANTHROPIC_MODEL: 'claude-sonnet-4-20250514',
  },
}));

const mockCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

import { AnthropicService } from '@/services/AnthropicService';

describe('AnthropicService', () => {
  let service: AnthropicService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AnthropicService();
  });

  it('calls claude-sonnet-4-20250514 model', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '{"proposal":{}}' }],
      usage: { input_tokens: 100, output_tokens: 50 },
      stop_reason: 'end_turn',
    });

    await service.complete('system prompt', [{ role: 'user', content: 'hello' }]);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-sonnet-4-20250514' }),
    );
  });

  it('returns parsed content, latencyMs, and tokensUsed', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'response text' }],
      usage: { input_tokens: 80, output_tokens: 40 },
      stop_reason: 'end_turn',
    });

    const result = await service.complete('sys', [{ role: 'user', content: 'q' }]);

    expect(result.content).toBe('response text');
    expect(result.tokensUsed).toBe(120);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('returns empty string when response has no text block', async () => {
    mockCreate.mockResolvedValue({
      content: [],
      usage: { input_tokens: 10, output_tokens: 0 },
      stop_reason: 'end_turn',
    });

    const result = await service.complete('sys', [{ role: 'user', content: 'q' }]);
    expect(result.content).toBe('');
  });

  it('does not log ANTHROPIC_API_KEY', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 5, output_tokens: 5 },
      stop_reason: 'end_turn',
    });

    const logSpy = vi.fn();
    vi.spyOn(console, 'log').mockImplementation(logSpy);

    await service.complete('sys', [{ role: 'user', content: 'q' }]);

    for (const call of logSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('test-key');
    }
  });
});
