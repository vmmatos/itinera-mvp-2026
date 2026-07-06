import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Trip } from '@/entities/Trip';

@Entity('trip_metrics')
export class TripMetric {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'trip_id', type: 'uuid' })
  tripId!: string;

  @Column({ type: 'integer' })
  round!: number;

  @Column({ name: 'consensus_score', type: 'numeric', precision: 5, scale: 2, nullable: true })
  consensusScore!: number | null;

  @Column({ name: 'conflict_count', type: 'integer', default: 0 })
  conflictCount!: number;

  @Column({ name: 'convergence_rounds', type: 'integer', nullable: true })
  convergenceRounds!: number | null;

  @Column({ name: 'forced_convergence', type: 'boolean', nullable: true })
  forcedConvergence!: boolean | null;

  @Column({ name: 'finance_block_count', type: 'integer', nullable: true })
  financeBlockCount!: number | null;

  @Column({ name: 'logistics_block_count', type: 'integer', nullable: true })
  logisticsBlockCount!: number | null;

  @Column({ name: 'total_tokens_used', type: 'integer', nullable: true })
  totalTokensUsed!: number | null;

  @Column({ name: 'total_time_ms', type: 'integer', nullable: true })
  totalTimeMs!: number | null;

  @Column({ type: 'jsonb', default: {} })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => Trip, (trip) => trip.metrics, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'trip_id' })
  trip!: Trip;
}
