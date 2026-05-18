import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config } from '@/config';
import { Proposal } from '@/entities/Proposal';
import { Traveller } from '@/entities/Traveller';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: config.POSTGRES_HOST,
  port: config.POSTGRES_PORT,
  database: config.POSTGRES_DB,
  username: config.POSTGRES_USER,
  password: config.POSTGRES_PASSWORD,
  synchronize: false,
  logging: config.NODE_ENV === 'development',
  entities: [Proposal, Traveller],
});
