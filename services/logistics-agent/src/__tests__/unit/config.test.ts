import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Required (no-default) env vars the schema needs to safeParse successfully —
// stubbed to arbitrary non-empty values so we can isolate the MOCK-flag
// coercion behaviour under test without the module short-circuiting via
// `process.exit(1)` on unrelated missing fields.
const REQUIRED_ENV = {
  ANTHROPIC_API_KEY: 'test-key',
  POSTGRES_PASSWORD: 'test-pass',
  RABBITMQ_DEFAULT_PASS: 'test-pass',
  JWT_SECRET: 'test-secret',
  OPENWEATHERMAP_API_KEY: 'test-key',
  GOOGLE_PLACES_API_KEY: 'test-key',
  GOOGLE_MAPS_API_KEY: 'test-key',
};

const loadConfig = async (overrides: Record<string, string>): Promise<typeof import('@/config').config> => {
  vi.resetModules();
  delete process.env.EVENTS_MOCK;
  delete process.env.LOCAL_TRANSIT_MOCK;
  for (const [key, value] of Object.entries({ ...REQUIRED_ENV, ...overrides })) {
    vi.stubEnv(key, value);
  }
  const mod = await import('@/config');
  return mod.config;
};

describe('logistics-agent config — MOCK boolean flags', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // Regression: z.coerce.boolean() runs JS `Boolean(str)`, so ANY non-empty
  // string — including the literal "false" — coerces to `true`. This silently
  // forced EVENTS_MOCK/LOCAL_TRANSIT_MOCK on in every environment that set
  // them to "false" instead of leaving them unset (dev/.dev.env did exactly
  // that), always returning mock special-events data regardless of a real
  // TICKETMASTER_API_KEY being configured.
  it('error: EVENTS_MOCK=false in the env parses to boolean false, not true', async () => {
    const config = await loadConfig({ EVENTS_MOCK: 'false' });
    expect(config.EVENTS_MOCK).toBe(false);
  });

  it('EVENTS_MOCK=true in the env parses to boolean true', async () => {
    const config = await loadConfig({ EVENTS_MOCK: 'true' });
    expect(config.EVENTS_MOCK).toBe(true);
  });

  it('EVENTS_MOCK unset defaults to false', async () => {
    const config = await loadConfig({});
    expect(config.EVENTS_MOCK).toBe(false);
  });

  it('error: LOCAL_TRANSIT_MOCK=false in the env parses to boolean false, not true', async () => {
    const config = await loadConfig({ LOCAL_TRANSIT_MOCK: 'false' });
    expect(config.LOCAL_TRANSIT_MOCK).toBe(false);
  });

  it('LOCAL_TRANSIT_MOCK=true in the env parses to boolean true', async () => {
    const config = await loadConfig({ LOCAL_TRANSIT_MOCK: 'true' });
    expect(config.LOCAL_TRANSIT_MOCK).toBe(true);
  });
});
