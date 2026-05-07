import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { User } from '@/entities/User';
import { Trip } from '@/entities/Trip';
import { Traveller } from '@/entities/Traveller';
import { Proposal } from '@/entities/Proposal';
import { AgentLog } from '@/entities/AgentLog';
import { SatisfactionScore } from '@/entities/SatisfactionScore';
import { Attraction } from '@/entities/Attraction';
import { TripMetric } from '@/entities/TripMetric';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env['POSTGRES_HOST'] ?? 'localhost',
  port: parseInt(process.env['POSTGRES_PORT'] ?? '5432', 10),
  database: process.env['POSTGRES_DB'] ?? 'itinera',
  username: process.env['POSTGRES_USER'] ?? 'itinera',
  password: process.env['POSTGRES_PASSWORD'],
  synchronize: false,
  logging: process.env['NODE_ENV'] === 'development',
  entities: [User, Trip, Traveller, Proposal, AgentLog, SatisfactionScore, Attraction, TripMetric],
  migrations: ['src/migrations/*.ts'],
});
