import type { Migration } from '../migrations';

/**
 * status.zerosoft.ai: estado de cada componente, historial por minuto (7 días)
 * y por hora (90 días), incidentes con su línea de tiempo, y los contadores por
 * día que dibujan las barras públicas (lib/status/store.ts).
 */
export default {
  id: '20261114_1912_status_monitoring',
  up: async (c) => {
    for (const sql of [
      `CREATE TABLE IF NOT EXISTS status_components (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'unknown',
        fail_streak INTEGER NOT NULL DEFAULT 0,
        ok_streak INTEGER NOT NULL DEFAULT 0,
        severity TEXT,
        checked_at INTEGER,
        last_ok_at INTEGER,
        last_error TEXT,
        detail TEXT,
        metrics TEXT,
        reported_at INTEGER,
        incident_id TEXT,
        rev INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE TABLE IF NOT EXISTS status_public (
        id TEXT PRIMARY KEY,
        days TEXT NOT NULL DEFAULT '[]',
        updated_at INTEGER
      )`,
      `CREATE TABLE IF NOT EXISTS status_minutes (
        component TEXT NOT NULL,
        minute INTEGER NOT NULL,
        status INTEGER NOT NULL,
        PRIMARY KEY (component, minute)
      ) WITHOUT ROWID`,
      `CREATE TABLE IF NOT EXISTS status_hours (
        component TEXT NOT NULL,
        hour INTEGER NOT NULL,
        up INTEGER NOT NULL DEFAULT 0,
        degraded INTEGER NOT NULL DEFAULT 0,
        down INTEGER NOT NULL DEFAULT 0,
        unknown INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (component, hour)
      ) WITHOUT ROWID`,
      `CREATE TABLE IF NOT EXISTS status_incidents (
        id TEXT PRIMARY KEY,
        component TEXT NOT NULL,
        public_id TEXT NOT NULL,
        title TEXT NOT NULL,
        severity TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'open',
        is_public INTEGER NOT NULL DEFAULT 0,
        started_at INTEGER NOT NULL,
        last_failure_at INTEGER NOT NULL,
        resolved_at INTEGER,
        failures INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        notified_at INTEGER
      )`,
      // Un solo incidente abierto por componente (dedupe aunque dos corridas se pisen).
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_status_incidents_open ON status_incidents(component) WHERE state = 'open'`,
      'CREATE INDEX IF NOT EXISTS idx_status_incidents_started ON status_incidents(started_at)',
      `CREATE TABLE IF NOT EXISTS status_incident_notes (
        id TEXT PRIMARY KEY,
        incident_id TEXT NOT NULL,
        at INTEGER NOT NULL,
        by TEXT NOT NULL,
        kind TEXT NOT NULL,
        text TEXT NOT NULL DEFAULT '',
        is_public INTEGER NOT NULL DEFAULT 0
      )`,
      'CREATE INDEX IF NOT EXISTS idx_status_incident_notes ON status_incident_notes(incident_id, at)',
      `CREATE TABLE IF NOT EXISTS status_meta (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        last_minute INTEGER NOT NULL DEFAULT 0,
        last_run_at INTEGER,
        notify_hour INTEGER NOT NULL DEFAULT 0,
        notify_count INTEGER NOT NULL DEFAULT 0
      )`,
      'INSERT OR IGNORE INTO status_meta (id) VALUES (1)',
    ]) {
      await c.execute(sql);
    }
  },
} satisfies Migration;
