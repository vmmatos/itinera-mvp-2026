import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const mockCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

import { AnthropicService } from '../../services/AnthropicService';

const HAPPY_RESPONSE = {
  content: [{ type: 'text', text: 'response text' }],
  usage: { input_tokens: 80, output_tokens: 40 },
  stop_reason: 'end_turn',
};

describe('AnthropicService — happy path', () => {
  let service: AnthropicService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AnthropicService('test-api-key', 'claude-sonnet-4-20250514');
  });

  it('returns content, latencyMs, tokensUsed', async () => {
    mockCreate.mockResolvedValue(HAPPY_RESPONSE);

    const result = await service.complete('sys', [{ role: 'user', content: 'hi' }]);

    expect(result.content).toBe('response text');
    expect(result.tokensUsed).toBe(120);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('uses the model passed to constructor', async () => {
    mockCreate.mockResolvedValue(HAPPY_RESPONSE);

    await service.complete('sys', [{ role: 'user', content: 'hi' }]);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-sonnet-4-20250514' }),
    );
  });

  it('defaults to 4096 max_tokens when no override is given', async () => {
    mockCreate.mockResolvedValue(HAPPY_RESPONSE);

    await service.complete('sys', [{ role: 'user', content: 'hi' }]);

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ max_tokens: 4096 }));
  });

  it('honours a maxTokens override for large itinerary output', async () => {
    mockCreate.mockResolvedValue(HAPPY_RESPONSE);

    await service.complete('sys', [{ role: 'user', content: 'hi' }], { maxTokens: 8192 });

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ max_tokens: 8192 }));
  });

  it('returns truncated: false for a normal completed response', async () => {
    mockCreate.mockResolvedValue(HAPPY_RESPONSE);

    const result = await service.complete('sys', [{ role: 'user', content: 'hi' }]);
    expect(result.truncated).toBe(false);
  });

  it('returns truncated: true when Anthropic stop_reason is "max_tokens" (provider-specific value stays internal)', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'truncated mid-sent' }],
      usage: { input_tokens: 80, output_tokens: 8192 },
      stop_reason: 'max_tokens',
    });

    const result = await service.complete('sys', [{ role: 'user', content: 'hi' }], { maxTokens: 8192 });
    expect(result.truncated).toBe(true);
  });

  it('returns empty string when response has no text block', async () => {
    mockCreate.mockResolvedValue({
      content: [],
      usage: { input_tokens: 10, output_tokens: 0 },
      stop_reason: 'end_turn',
    });

    const result = await service.complete('sys', [{ role: 'user', content: 'hi' }]);
    expect(result.content).toBe('');
  });
});

describe('AnthropicService — retry logic', () => {
  let service: AnthropicService;

  beforeEach(() => {
    vi.clearAllMocks();
    // Make all retry delays instant so tests don't hang
    vi.stubGlobal('setTimeout', (fn: (...args: unknown[]) => void) => { fn(); return 0; });
    service = new AnthropicService('test-api-key', 'claude-sonnet-4-20250514');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retries on 429 and succeeds on second attempt', async () => {
    const rateLimitErr = Object.assign(new Error('rate limited'), { status: 429 });
    mockCreate.mockRejectedValueOnce(rateLimitErr);
    mockCreate.mockResolvedValueOnce(HAPPY_RESPONSE);

    const result = await service.complete('sys', [{ role: 'user', content: 'hi' }]);

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(result.content).toBe('response text');
  });

  it('retries on 500 server error', async () => {
    const serverErr = Object.assign(new Error('server error'), { status: 500 });
    mockCreate.mockRejectedValueOnce(serverErr);
    mockCreate.mockResolvedValueOnce(HAPPY_RESPONSE);

    await service.complete('sys', [{ role: 'user', content: 'hi' }]);

    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('throws immediately on non-retryable error (4xx != 429)', async () => {
    const authErr = Object.assign(new Error('unauthorized'), { status: 401 });
    mockCreate.mockRejectedValue(authErr);

    await expect(
      service.complete('sys', [{ role: 'user', content: 'hi' }]),
    ).rejects.toMatchObject({ status: 401 });

    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('exhausts 3 retries then throws', async () => {
    const serverErr = Object.assign(new Error('server error'), { status: 503 });
    mockCreate.mockRejectedValue(serverErr);

    await expect(
      service.complete('sys', [{ role: 'user', content: 'hi' }]),
    ).rejects.toMatchObject({ status: 503 });

    expect(mockCreate).toHaveBeenCalledTimes(3);
  });
});
