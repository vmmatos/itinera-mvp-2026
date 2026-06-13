import fs from 'fs';
import path from 'path';
import type { AgentName, IAIProvider } from '@itinera/shared';
import { BaseAgent } from '@/agents/BaseAgent';
import type { RabbitMQPublisher } from '@/services/RabbitMQPublisher';
import type { RedisService } from '@/services/RedisService';
import type { ProposalStorageService } from '@/services/ProposalStorageService';

export class PreferenceAgent extends BaseAgent {
  readonly agentName: AgentName;
  readonly systemPrompt: string;

  constructor(
    name: AgentName,
    aiProvider: IAIProvider,
    publisher: RabbitMQPublisher,
    redis: RedisService,
    storage: ProposalStorageService,
  ) {
    super(aiProvider, publisher, redis, storage);
    this.agentName = name;
    this.systemPrompt = fs.readFileSync(
      path.join(__dirname, '../config/prompts', `${name}.txt`),
      'utf-8',
    );
  }
}
