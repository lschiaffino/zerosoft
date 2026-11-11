import type { Client } from '@libsql/client';

/**
 * Menos filas leídas cuando no pasa nada (el plan de la base cobra por fila
 * leída): lo que corre cada minuto o por cada evento deja de recorrer tablas.
 *
 * - wa_contacts: los índices por teléfono y por lid eran parciales
 *   (phone <> '' / lid <> '') y una búsqueda con el valor como parámetro no
 *   los puede usar: cada mensaje de WhatsApp recorría la libreta entera.
 * - notifications: el orden de la campana como índice (lee las 5 filas que
 *   muestra) y los sin leer desde un índice que ya trae lo que se filtra.
 *   notification_rev guarda una versión por persona (la suben los triggers)
 *   para responder 304 leyendo una fila (lib/notification-rev.ts).
 * - Índices parciales "qué vence" para los trabajos del minuto que
 *   recorrían su tabla.
 *
 * OJO: un trigger vive con su tabla. Una migración que reconstruya
 * notifications tiene que recrearlos (NOTIFICATION_REV_TRIGGERS).
 */
const bump = (who: string) => `INSERT INTO notification_rev (user_id, rev) VALUES (${who}, 1) ON CONFLICT(user_id) DO UPDATE SET rev = rev + 1;`;

export const NOTIFICATION_REV_TRIGGERS: ReadonlyArray<readonly [string, string]> = [
  ['trg_notifications_rev_insert', `AFTER INSERT ON notifications BEGIN ${bump('NEW.user_id')} END`],
  ['trg_notifications_rev_update', `AFTER UPDATE ON notifications BEGIN ${bump('NEW.user_id')} END`],
  ['trg_notifications_rev_delete', `AFTER DELETE ON notifications BEGIN ${bump('OLD.user_id')} END`],
];

/** Los "tipos efímeros" de talk_events: el mismo texto en el índice y en las consultas que lo usan. */
export const TALK_EPHEMERAL_KINDS = "kind IN ('typing', 'signal', 'ephemeral')";

export const FEWER_READS_INDEXES: readonly string[] = [
  // WhatsApp (Inbox y Lines): la libreta por teléfono y por lid, sin condición.
  'CREATE INDEX IF NOT EXISTS idx_wa_contacts_acct_phone ON wa_contacts(app, account_id, phone)',
  'CREATE INDEX IF NOT EXISTS idx_wa_contacts_acct_lid ON wa_contacts(app, account_id, lid)',
  // Lines: el nombre de un contacto en los grupos donde está (antes: una búsqueda por cada chat del número).
  'CREATE INDEX IF NOT EXISTS idx_groups_members_phone ON groups_members(phone)',
  // Avisos: la lista en su orden y los sin leer.
  'CREATE INDEX IF NOT EXISTS idx_notifications_user_recent ON notifications(user_id, COALESCE(snoozed_until, created_at) DESC)',
  'CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, snoozed_until, href, read_at) WHERE read_at IS NULL',
  'CREATE INDEX IF NOT EXISTS idx_notifications_snoozed ON notifications(user_id, snoozed_until) WHERE snoozed_until IS NOT NULL',
  // Send.
  'CREATE INDEX IF NOT EXISTS idx_send_download_cache_expires ON send_download_cache(expires_at)',
  'CREATE INDEX IF NOT EXISTS idx_send_links_digest_due ON send_links(alert_window_at) WHERE alert_digest > 0 AND deleted_at IS NULL',
  'CREATE INDEX IF NOT EXISTS idx_send_sessions_expires ON send_sessions(expires_at)',
  'CREATE INDEX IF NOT EXISTS idx_send_email_codes_expires ON send_email_codes(expires_at)',
  // Chat.
  'CREATE INDEX IF NOT EXISTS idx_chat_messages_offline_due ON chat_messages(created_at) WHERE read_at IS NULL AND offline_email_at IS NULL AND deleted_at IS NULL AND is_note = 0',
  "CREATE INDEX IF NOT EXISTS idx_chat_campaign_rec_claimed ON chat_campaign_recipients(claimed_at) WHERE status = 'claimed'",
  'CREATE INDEX IF NOT EXISTS idx_chat_events_created ON chat_events(created_at)',
  // Track.
  "CREATE INDEX IF NOT EXISTS idx_track_notify_prefs_immediate ON track_notify_prefs(user_id) WHERE email_mode = 'immediate'",
  'CREATE INDEX IF NOT EXISTS idx_track_issue_slas_risk_due ON track_issue_slas(risk_at) WHERE completed_at IS NULL AND risk_notified_at IS NULL',
  'CREATE INDEX IF NOT EXISTS idx_track_issue_slas_breach_due ON track_issue_slas(due_at) WHERE completed_at IS NULL AND breach_notified_at IS NULL',
  // Lines.
  "CREATE INDEX IF NOT EXISTS idx_groups_chats_to_assign ON groups_chats(user_id, awaiting_since) WHERE status = 'open' AND assigned_to IS NULL AND awaiting_since IS NOT NULL",
  'CREATE INDEX IF NOT EXISTS idx_groups_assign_rules_enabled ON groups_assign_rules(user_id) WHERE enabled = 1',
  'CREATE INDEX IF NOT EXISTS idx_groups_hubspot_notes_day ON groups_hubspot_notes(day)',
  'CREATE INDEX IF NOT EXISTS idx_groups_hubspot_sync_log_created ON groups_hubspot_sync_log(created_at)',
  // Voice, Rec, Calls.
  "CREATE INDEX IF NOT EXISTS idx_voice_sessions_notes_queued ON voice_sessions(updated_at) WHERE notes_status = 'queued'",
  "CREATE INDEX IF NOT EXISTS idx_rec_videos_recording ON rec_videos(created_at) WHERE status = 'recording'",
  'CREATE INDEX IF NOT EXISTS idx_calls_status_updated ON calls(status, updated_at)',
  // Talk.
  'CREATE INDEX IF NOT EXISTS idx_talk_events_created ON talk_events(created_at)',
  `CREATE INDEX IF NOT EXISTS idx_talk_events_ephemeral ON talk_events(created_at) WHERE ${TALK_EPHEMERAL_KINDS}`,
  'CREATE INDEX IF NOT EXISTS idx_talk_command_responses_expires ON talk_command_responses(expires_at)',
  // Social.
  'CREATE INDEX IF NOT EXISTS idx_social_oauth_states_expires ON social_oauth_states(expires_at)',
  'CREATE INDEX IF NOT EXISTS idx_social_webhook_events_created ON social_webhook_events(created_at)',
  // Cuentas y ajustes (tablas chicas: una fila por cuenta conectada): solo las que el trabajo mira.
  'CREATE INDEX IF NOT EXISTS idx_inbox_accounts_kind_status ON inbox_accounts(kind, status)',
  'CREATE INDEX IF NOT EXISTS idx_groups_numbers_status ON groups_numbers(status)',
  'CREATE INDEX IF NOT EXISTS idx_social_accounts_status ON social_accounts(status)',
  'CREATE INDEX IF NOT EXISTS idx_track_linear_sync_phase ON track_linear_sync_state(phase)',
  "CREATE INDEX IF NOT EXISTS idx_calls_prefs_auto ON calls_prefs(synced_at) WHERE auto_join != 'manual'",
  'CREATE INDEX IF NOT EXISTS idx_rec_settings_retention ON rec_settings(retention_starts_at) WHERE retention_days IS NOT NULL',
  "CREATE INDEX IF NOT EXISTS idx_groups_hubspot_connected ON groups_hubspot(user_id) WHERE token != ''",
  // Agents.
  'CREATE INDEX IF NOT EXISTS idx_agent_sitemaps_status ON agent_sitemaps(status)',
  'CREATE INDEX IF NOT EXISTS idx_agent_sitemaps_listed ON agent_sitemaps(listed_at)',
  'CREATE INDEX IF NOT EXISTS idx_agent_sources_status ON agent_sources(status)',
  'CREATE INDEX IF NOT EXISTS idx_agent_sources_synced ON agent_sources(synced_at)',
  `CREATE INDEX IF NOT EXISTS idx_agents_semantic ON agents(embed_claimed_until) WHERE settings LIKE '%"semanticSearch":true%'`,
  "CREATE INDEX IF NOT EXISTS idx_agent_knowledge_urls_pending ON agent_knowledge_urls(created_at) WHERE status = 'pending' AND fetched_at IS NULL",
];

export async function fewerReadsUp(c: Client): Promise<void> {
  for (const sql of FEWER_READS_INDEXES) await c.execute(sql);
  await c.execute('CREATE TABLE IF NOT EXISTS notification_rev (user_id TEXT PRIMARY KEY, rev INTEGER NOT NULL DEFAULT 0)');
  for (const [name, body] of NOTIFICATION_REV_TRIGGERS) await c.execute(`CREATE TRIGGER IF NOT EXISTS ${name} ${body}`);
}
