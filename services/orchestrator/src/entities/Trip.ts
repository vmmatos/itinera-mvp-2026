import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '@/entities/User';
import type { Traveller } from '@/entities/Traveller';
import type { Proposal } from '@/entities/Proposal';
import type { TripMetric } from '@/entities/TripMetric';
import type { SatisfactionScore } from '@/entities/SatisfactionScore';

@Entity('trips')
export class Trip {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 50, default: 'draft' })
  status!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  region!: string | null;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId!: string;

  @Column({ name: 'start_date', type: 'date', nullable: true })
  startDate!: Date | null;

  @Column({ name: 'end_date', type: 'date', nullable: true })
  endDate!: Date | null;

  @Column({ name: 'budget_total', type: 'numeric', precision: 12, scale: 2, nullable: true })
  budgetTotal!: number | null;

  @Column({ name: 'budget_currency', type: 'varchar', length: 10, default: 'EUR' })
  budgetCurrency!: string;

  @Column({ type: 'jsonb', default: [] })
  destinations!: Array<{ country: string; city?: string; nights: number }>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @ManyToOne(() => User, (user) => user.trips, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner!: User;

  @OneToMany('Traveller', 'trip')
  travellers!: Traveller[];

  @OneToMany('Proposal', 'trip')
  proposals!: Proposal[];

  @OneToMany('TripMetric', 'trip')
  metrics!: TripMetric[];

  @OneToMany('SatisfactionScore', 'trip')
  satisfactionScores!: SatisfactionScore[];
}
