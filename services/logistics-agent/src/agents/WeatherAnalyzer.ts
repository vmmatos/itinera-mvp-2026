import fs from 'fs';
import path from 'path';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import type { AgentEvent, AgentName } from '@itinera/shared';
import { BaseLogisticsAgent } from '@/agents/BaseLogisticsAgent';
import type { WeatherForecast } from '@/services/WeatherService';
import type { TimingValidationResult } from '@/validators/TimingValidator';
import { config } from '@/config';

export class WeatherAnalyzer extends BaseLogisticsAgent {
  readonly agentName: AgentName = 'logistics';
  readonly systemPrompt: string;

  constructor(...args: ConstructorParameters<typeof BaseLogisticsAgent>) {
    super(...args);
    this.systemPrompt = fs.readFileSync(
      path.join(__dirname, '../config/prompts/logistics-validator.txt'),
      'utf-8',
    );
  }

  async analyze(
    tripId: string,
    round: number,
    itinerary: unknown,
    weatherForecasts: WeatherForecast[],
    timingResult: TimingValidationResult,
  ): Promise<AgentEvent> {
    return this.handleAsync(async () => {
      const cacheKey = `logistics:${tripId}:weather-analyzer:${round}:propose`;
      const cached = await this.redis.get<AgentEvent>(cacheKey);
      if (cached) {
        this.logger.info('Cache hit', { agent: this.agentName, tripId, round, action: 'propose' });
        return cached;
      }

      const messages: MessageParam[] = [
        {
          role: 'user',
          content: [
            `Trip ID: ${tripId}`,
            `Round: ${round}`,
            '',
            'Itinerary:',
            JSON.stringify(itinerary, null, 2),
            '',
            'Weather forecasts:',
            JSON.stringify(weatherForecasts, null, 2),
            '',
            'Timing validation result:',
            JSON.stringify(timingResult, null, 2),
            '',
            'Analyse the weather impact on outdoor activities, flag risky days, and suggest alternative times or indoor fallbacks where needed. Respond with valid JSON only.',
          ].join('\n'),
        },
      ];

      const event = await this.callClaudeAndBuild(tripId, round, 'propose', messages);
      await this.redis.set(cacheKey, event, config.CACHE_TTL_SECONDS);
      return event;
    });
  }
}
