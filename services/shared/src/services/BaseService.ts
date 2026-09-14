import type { Logger } from 'winston';
import { createLogger } from '../logger';

export abstract class BaseService {
  protected readonly logger: Logger;
  readonly serviceName: string;

  constructor(serviceName: string) {
    this.serviceName = serviceName;
    this.logger = createLogger(serviceName);
  }

  protected async handleAsync<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      this.logger.error('Service error', {
        service: this.serviceName,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      throw err;
    }
  }
}
