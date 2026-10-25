import { normalizeDatabase } from './schema';
import { DB_SCHEMA_VERSION, type Database } from './types';

export interface MigrationResult {
  db: Database;
  fromVersion: number;
  applied: number[];
  repaired: boolean;
  droppedProfiles: number;
  droppedSubscriptions: number;
  futureVersion: boolean;
}

/**
 * Migrate any stored blob to the current schema. Unknown/corrupt fields are
 * repaired rather than thrown away wholesale; profiles that no longer validate
 * are dropped individually.
 */
export function migrate(raw: unknown): MigrationResult {
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const fromVersion = typeof record['schemaVersion'] === 'number' ? record['schemaVersion'] : 0;
  const normalized = normalizeDatabase(raw);
  const applied: number[] = [];
  if (fromVersion < DB_SCHEMA_VERSION) applied.push(DB_SCHEMA_VERSION);
  return {
    db: normalized.db,
    fromVersion,
    applied,
    repaired: normalized.repaired,
    droppedProfiles: normalized.droppedProfiles,
    droppedSubscriptions: normalized.droppedSubscriptions,
    futureVersion: fromVersion > DB_SCHEMA_VERSION,
  };
}
