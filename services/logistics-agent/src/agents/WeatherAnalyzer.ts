import fs from 'fs';
import path from 'path';
import type { AgentEvent, AgentName, AIMessage, DateInput, TransportOption } from '@itinera/shared';
import { BaseLogisticsAgent } from '@/agents/BaseLogisticsAgent';
import type { WeatherForecast } from '@/services/WeatherService';
import type { TimingValidationResult } from '@/validators/TimingValidator';
import type { RestrictionWarning } from '@/validators/RestrictionsValidator';
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
    dateInput?: DateInput | null,
    restrictionWarnings?: RestrictionWarning[],
    transportOptions?: Record<number, TransportOption[]>,
  ): Promise<AgentEvent> {
    return this.handleAsync(async () => {
      const cacheKey = `logistics:${tripId}:weather-analyzer:${round}:propose`;
      const cached = await this.redis.get<AgentEvent>(cacheKey);
      if (cached) {
        this.logger.info('Cache hit', { agent: this.agentName, tripId, round, action: 'propose' });
        return cached;
      }

      const flexSection: string[] = dateInput?.mode === 'flexible' && dateInput.preferredMonth
        ? [
            '',
            `DATE SELECTION MODE: flexible — ${dateInput.days} days in ${dateInput.preferredMonth} (window: ${dateInput.window})`,
            'Based on the weather forecasts above, select the optimal consecutive window within this month.',
            'Add a "suggestedDates" key to your JSON response:',
            '  "suggestedDates": { "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD", "rationale": "..." }',
            'If forecast data covers fewer days than needed, note this in rationale and omit startDate/endDate.',
          ]
        : [];

      const restrictionsSection: string[] =
        restrictionWarnings && restrictionWarnings.length > 0
          ? [
              '',
              'Local restriction warnings (pre-computed):',
              JSON.stringify(restrictionWarnings, null, 2),
              'Factor these into your affectedActivities — propose specific real alternative venues for each restricted activity.',
            ]
          : [];

      // Pass only the best option (first) per day to keep the prompt concise
      const transportSection: string[] =
        transportOptions && Object.keys(transportOptions).length > 0
          ? [
              '',
              'Transport legs (resolved — best option per day):',
              JSON.stringify(
                Object.fromEntries(
                  Object.entries(transportOptions).map(([k, v]) => [k, v[0]]),
                ),
                null, 2,
              ),
            ]
          : [];

      const messages: AIMessage[] = [
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
            ...restrictionsSection,
            ...transportSection,
            ...flexSection,
            '',
            'Analyse the weather impact on outdoor activities, flag risky days, and suggest alternative times or indoor fallbacks where needed. Respond with valid JSON only.',
          ].join('\n'),
        },
      ];

      const event = await this.callAIAndBuild(tripId, round, 'propose', messages);
      await this.redis.set(cacheKey, event, config.CACHE_TTL_SECONDS);
      return event;
    });
  }
}
