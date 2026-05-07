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

  @Column({ type: 'jsonb', default: {} })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => Trip, (trip) => trip.metrics, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'trip_id' })
  trip!: Trip;
}
