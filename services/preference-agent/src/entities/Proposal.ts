import 'reflect-metadata';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('proposals')
export class Proposal {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'trip_id', type: 'uuid' })
  tripId!: string;

  @Column({ type: 'varchar', length: 100 })
  agent!: string;

  @Column({ type: 'integer' })
  round!: number;

  @Column({ type: 'jsonb', default: {} })
  content!: Record<string, unknown>;

  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true })
  score!: number | null;

  @Column({ type: 'varchar', length: 50, default: 'pending' })
  status!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
