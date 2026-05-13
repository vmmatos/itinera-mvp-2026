import fs from 'fs';
import path from 'path';
import type { AgentName } from '@itinera/shared';
import { BaseAgent } from '@/agents/BaseAgent';
import type { AnthropicService } from '@/services/AnthropicService';
import type { RabbitMQPublisher } from '@/services/RabbitMQPublisher';
import type { RedisService } from '@/services/RedisService';
import type { ProposalStorageService } from '@/services/ProposalStorageService';

export class AliceAgent extends BaseAgent {
  readonly agentName: AgentName = 'alice';
  readonly systemPrompt: string;

  constructor(
    anthropic: AnthropicService,
    publisher: RabbitMQPublisher,
    redis: RedisService,
    storage: ProposalStorageService,
  ) {
    super(anthropic, publisher, redis, storage);
    this.systemPrompt = fs.readFileSync(
      path.join(__dirname, '../config/prompts/alice.txt'),
      'utf-8',
    );
  }
}
