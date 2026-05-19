import { RabbitMQPublisher as SharedRabbitMQPublisher } from '@itinera/shared';
import { config, getRabbitMQUrl } from '@/config';

export class RabbitMQPublisher extends SharedRabbitMQPublisher {
  constructor() {
    super(getRabbitMQUrl(), config.RABBITMQ_EXCHANGE);
  }
}
