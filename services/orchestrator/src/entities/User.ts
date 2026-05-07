import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Trip } from '@/entities/Trip';
import type { Traveller } from '@/entities/Traveller';
import type { SatisfactionScore } from '@/entities/SatisfactionScore';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  email!: string;

  @Column({ type: 'varchar', length: 255, name: 'password_hash' })
  passwordHash!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 50, default: 'user' })
  role!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany('Trip', 'owner')
  trips!: Trip[];

  @OneToMany('Traveller', 'user')
  travellers!: Traveller[];

  @OneToMany('SatisfactionScore', 'user')
  satisfactionScores!: SatisfactionScore[];
}
