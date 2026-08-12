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
    // Kept in the signature (callers pass it positionally) but no longer used
    // in the prompt: flexible trips never get a forecast, so the model is not
    // asked to pick a "best window" it has no data to pick from.
    dateInput?: DateInput | null,
    restrictionWarnings?: RestrictionWarning[],
    transportOptions?: Record<number, TransportOption[]>,
    tripDates?: string[],
  ): Promise<AgentEvent> {
    return this.handleAsync(async () => {
      const cacheKey = `logistics:${tripId}:weather-analyzer:${round}:propose`;
      const cached = await this.redis.get<AgentEvent>(cacheKey);
      if (cached) {
        this.logger.info('Cache hit', { agent: this.agentName, tripId, round, action: 'propose' });
        return cached;
      }

      // The itinerary JSON the model sees carries `day: <number>` and often no
      // date at all, so asking for dayAssessments[].date without handing it the
      // calendar produced null/wrong dates — and the real forecast, matched by
      // date downstream, never reached the UI. Give it the mapping explicitly.
      const tripDatesSection: string[] =
        tripDates && tripDates.length > 0
          ? [
              '',
              'Trip calendar (authoritative — day number ⇄ calendar date):',
              tripDates.map((d, i) => `  day ${i + 1} → ${d}`).join('\n'),
              'Use EXACTLY these dates in dayAssessments[].date, and keep dayAssessments[].day equal to the itinerary day number.',
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
            ...tripDatesSection,
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
