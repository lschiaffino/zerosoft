import type { Migration } from '../migrations';

/**
 * Resumen del día de Lines e Inbox (lib/daily-brief.ts): el día local en que
 * cada persona cerró la tarjeta de cada app, y si pidió el email de la mañana
 * (con el último día en que salió, para mandarlo una sola vez).
 */
export default {
  id: '20261123_0832_daily_brief',
  async up(client) {
    await client.execute('CREATE TABLE IF NOT EXISTS daily_brief_dismissals (user_id TEXT NOT NULL, app TEXT NOT NULL, dismissed_day TEXT NOT NULL, PRIMARY KEY (user_id, app))');
    await client.execute('CREATE TABLE IF NOT EXISTS daily_brief_prefs (user_id TEXT PRIMARY KEY, email INTEGER NOT NULL DEFAULT 0, email_day TEXT, updated_at TEXT NOT NULL)');
  },
} satisfies Migration;
