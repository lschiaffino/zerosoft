/**
 * Menos filas leídas con todo quieto (migración 393_fewer_reads): lo que corre
 * cada minuto y lo que corre por cada evento de WhatsApp no recorre tablas, la
 * campana responde 304 leyendo una fila y los trabajos que no tienen nada
 * que hacer vuelven sin leer. Con proveedores falsos; nombres y números
 * inventados. Corre sobre una base propia (ver dbFile).
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Base propia y vacía: los demás tests comparten una y le dejan trabajo a los crons; acá "quieto" es quieto.
const dbFile = vi.hoisted(() => {
  const file = `${(process.env.TMPDIR ?? '/tmp').replace(/\/$/, '')}/zerosoft-quiet-${process.pid}-${Date.now()}.db`;
  process.env.TURSO_DATABASE_URL = `file:${file}`;
  return file;
});

import fs from 'fs';
import { NextRequest } from 'next/server';
import type { InValue } from '@libsql/client';
import { getDb } from '@/lib/db';
import { connectNumber, createNumber, getNumberRowById, ingestEvents, type NumberRow } from '@/lib/groups';
import { connectWhatsapp, ingestWhatsappEvents } from '@/lib/inbox/whatsapp';
import type { AccountRow } from '@/lib/inbox/core';
import { hasStaleInfo, refreshAllStaleInfo } from '@/lib/inbox/wa-meta';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { lookupContacts, rememberContacts } from '@/lib/wa-contacts';
import { createNotification, markAllNotificationsRead, snoozeNotification } from '@/lib/notifications';
import { nextSnoozeWake, notificationKey, notificationRev, notificationTag, notificationTagFresh } from '@/lib/notification-rev';
import { failureBackoffMs, pollDue } from '@/lib/use-visible-poll';
import { sweepAutoAssign } from '@/lib/groups-inbox';
import { pruneChatEvents } from '@/lib/chat-realtime';
import { runSlaChecks } from '@/lib/track-sla';
import { TALK_EPHEMERAL_KINDS } from '@/lib/schema/fewer-reads-migration';
import { makeUser } from './helpers';
import { planOf, recording, scansOf, tableScans } from './read-probe';

const session = vi.hoisted(() => ({ user: null as null | { id: string; email: string; actingUser?: { id: string } } }));
vi.mock('@/lib/session', async (orig) => ({
  ...(await orig<typeof import('@/lib/session')>()),
  getCurrentUser: async () => session.user,
}));

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('INBOX_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => {
  for (const ext of ['', '-wal', '-shm']) fs.rmSync(`${dbFile}${ext}`, { force: true });
});

const fakeState = (id: string) => (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(id);

async function linesSetup(label: string): Promise<{ ws: string; number: NumberRow }> {
  const u = await makeUser(label);
  const n = await createNumber(u.id, u.id, { provider: 'fake' });
  await connectNumber(u.id, n.id);
  const s = fakeState(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  await getDb().prepare("UPDATE groups_numbers SET status = 'connected' WHERE id = ?").run(n.id);
  return { ws: u.id, number: (await getNumberRowById(n.id))! };
}

async function inboxSetup(label: string): Promise<{ owner: string; account: AccountRow }> {
  const u = await makeUser(label);
  const { account } = await connectWhatsapp(u.id);
  await getDb().prepare("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?").run(account.id);
  const s = fakeState(`inbox-${account.id}`);
  if (s) s.connectedAt = Date.now() - 5000;
  return { owner: u.id, account: { ...account, status: 'connected' } };
}

function message(chatId: string, id: string, over: Record<string, unknown> = {}) {
  const group = chatId.endsWith('@g.us');
  return {
    type: 'message' as const,
    chatId,
    isGroup: group,
    fromMe: false,
    senderPhone: group ? '5491100093002' : chatId.replace(/@.*/, ''),
    senderName: 'Vera Prueba',
    providerMessageId: id,
    body: 'hola',
    timestamp: new Date().toISOString(),
    ...(group ? { chatName: 'Equipo de prueba' } : {}),
    ...over,
  };
}

/** Los trabajos de /api/cron/minute, /api/cron/send-render y /api/cron/calls, en el orden en que corren. */
const CRON_JOBS: Array<[string, () => Promise<unknown>]> = [
  ['cal-reminders', async () => (await import('@/app/api/calendar/reminders/due/route')).GET(new NextRequest('http://zerosoft.test/api/cron/minute'))],
  ['fireDueTasks', async () => (await import('@/lib/crm')).fireDueTasks()],
  ['purgeDownloadCache', async () => (await import('@/lib/send/viewer')).purgeDownloadCache()],
  ['flushAlertDigests', async () => (await import('@/lib/send/viewer')).flushAlertDigests()],
  ['purgeSendLeftovers', async () => (await import('@/lib/send/core')).purgeSendLeftovers()],
  ['retryDueWebhooks', async () => (await import('@/lib/webhooks')).retryDueWebhooks(100)],
  ['sendOfflineReplyEmails', async () => (await import('@/lib/chat-offline-email')).sendOfflineReplyEmails({ limit: 200 })],
  ['processChatCampaigns', async () => (await import('@/lib/chat-campaigns')).processChatCampaigns({ limit: 90 })],
  ['pruneChatEvents', async () => (await import('@/lib/chat-realtime')).pruneChatEvents()],
  ['runArchivePushes', async () => (await import('@/lib/wa-archive-sync')).runArchivePushes({ limit: 100, deadline: Date.now() + 30_000 })],
  ['pruneLiveEvents', async () => (await import('@/lib/wa-live')).pruneLiveEvents()],
  ['fireNoteReminders', async () => (await import('@/lib/notes-reminders')).fireNoteReminders({ limit: 200 })],
  ['fireNoteTasksDue', async () => (await import('@/lib/notes-tasks')).fireNoteTasksDue({ limit: 200 })],
  ['warmNoteEmbeddings', async () => (await import('@/lib/notes-semantic')).warmNoteEmbeddings()],
  ['fireDocReminders', async () => (await import('@/lib/docs-reminders')).fireDocReminders({ limit: 200 })],
  ['fireIssueReminders', async () => (await import('@/lib/track-notify')).fireIssueReminders({ limit: 200 })],
  ['sendImmediateTrackEmails', async () => (await import('@/lib/track-notify')).sendImmediateTrackEmails({ limit: 200 })],
  ['runSlaChecks', async () => (await import('@/lib/track-sla')).runSlaChecks({ limit: 200 })],
  ['processPendingAgentSessions', async () => (await import('@/lib/track-agents')).processPendingAgentSessions({ limit: 10, budgetMs: 20_000 })],
  ['processTrackIntegrationQueue', async () => (await import('@/lib/track-events')).processTrackIntegrationQueue({ limit: 100 })],
  ['runLinearSyncCron', async () => (await import('@/lib/track-linear-sync')).runLinearSyncCron({ budgetMs: 25_000 })],
  ['runGroupsCron', async () => (await import('@/lib/groups-cron')).runGroupsCron({ budgetMs: 30_000 })],
  ['runInboxCron', async () => (await import('@/lib/inbox/cron')).runInboxCron(new Date(), 30_000)],
  ['runVoiceCron', async () => (await import('@/lib/voice-jobs')).runVoiceCron({ budgetMs: 20_000, cleanup: false })],
  ['processAiRuns', async () => (await import('@/lib/crm-ai-agents')).processAiRuns({ budgetMs: 20_000 })],
  ['flushPageUpdatedEvents', async () => (await import('@/lib/docs-events')).flushPageUpdatedEvents()],
  ['syncDueSources', async () => (await import('@/lib/docs-sync')).syncDueSources({ budgetMs: 20_000 })],
  ['runNotionSync', async () => (await import('@/lib/notion-sync')).runNotionSync({ budgetMs: 25_000 })],
  ['processPendingRec', async () => (await import('@/lib/rec-ai')).processPendingRec({ limit: 5, budgetMs: 20_000 })],
  ['expirePendingOrders', async () => (await import('@/lib/shop-orders')).expirePendingOrders()],
  ['runTalkCron', async () => (await import('@/lib/talk-notify')).runTalkCron()],
  ['runSocialCron', async () => (await import('@/lib/social-cron')).runSocialCron({ budgetMs: 30_000 })],
  ['processPendingSitemaps', async () => (await import('@/lib/agents-knowledge')).processPendingSitemaps({ limit: 3 })],
  ['fetchPendingKnowledgeUrls', async () => (await import('@/lib/agents')).fetchPendingKnowledgeUrls({ limit: 15 })],
  ['processPendingSources', async () => (await import('@/lib/agents-sources')).processPendingSources({ limit: 2 })],
  ['warmAgentEmbeddings', async () => (await import('@/lib/agents-semantic')).warmAgentEmbeddings({ limit: 2 })],
  ['processFlowQueue', async () => (await import('@/lib/flow-worker')).processFlowQueue({ limit: 200, budgetMs: 10_000 })],
  ['processImportJobs', async () => (await import('@/lib/import-runner')).processImportJobs({ budgetMs: 5_000 })],
  ['processCrmImportJobs', async () => (await import('@/lib/crm-import-jobs')).processImportJobs({ budgetMs: 5_000 })],
  ['sendDailyRecaps', async () => (await import('@/lib/talk-ai')).sendDailyRecaps({ budgetMs: 15_000 })],
  ['processNoteFileQueue', async () => (await import('@/lib/notes-file-text')).processNoteFileQueue({ limit: 10, budgetMs: 20_000 })],
  ['send-render', async () => (await import('@/lib/send/core')).runSendRenderCron({ budgetMs: 60_000 })],
  ['calls', async () => (await import('@/lib/calls/process')).runCallsCron({ budgetMs: 60_000 })],
];

/**
 * Lo único que todavía recorre una tabla: las tareas creadas desde chats de
 * Lines (groups_tasks, una fila por tarea; antes este trabajo recorría todas
 * las actividades del CRM).
 */
const ALLOWED_SCANS = [/FROM groups_tasks t CROSS JOIN crm_activities a/];

describe('los crons de cada minuto', () => {
  it('ninguna consulta recorre una tabla entera', async () => {
    const offenders: string[] = [];
    let total = 0;
    for (const [name, job] of CRON_JOBS) {
      const seen = await recording(job);
      total += seen.length;
      for (const bad of await scansOf(seen, ALLOWED_SCANS)) offenders.push(`[${name}] ${bad}`);
    }
    expect(offenders).toEqual([]);
    // Guarda contra un trabajo nuevo que sume muchas consultas con todo quieto (hoy son unas 115).
    expect(total).toBeLessThan(160);
  }, 120_000);

  it('con WhatsApp conectado en Inbox y Lines, la segunda vuelta no relee los chats de la cuenta', async () => {
    const inbox = await inboxSetup('quieto-inbox');
    const lines = await linesSetup('quieto-lines');
    for (let i = 0; i < 3; i++) {
      const jid = `54911000930${10 + i}@s.whatsapp.net`;
      await ingestWhatsappEvents(inbox.account, [message(jid, `qi-${i}`)] as never);
      await ingestEvents(lines.number, [message(jid, `ql-${i}`)]);
    }
    const { runInboxCron } = await import('@/lib/inbox/cron');
    const { runGroupsCron } = await import('@/lib/groups-cron');
    // Primera vuelta: pide los datos de los chats nuevos.
    await runInboxCron(new Date(), 20_000);
    await runGroupsCron({ budgetMs: 5_000, importBudgetMs: 5_000, dailyBudgetMs: 3_000 });
    const second = await recording(async () => {
      await runInboxCron(new Date(), 20_000);
      await runGroupsCron({ budgetMs: 5_000, importBudgetMs: 5_000, dailyBudgetMs: 3_000 });
    });
    expect(await scansOf(second, ALLOWED_SCANS)).toEqual([]);
    expect(second.some((s) => /SELECT EXISTS \(SELECT 1 FROM inbox_threads WHERE account_id = \? AND info_at IS NULL\)/.test(s.sql))).toBe(true);
    expect(second.filter((s) => /SELECT \* FROM inbox_threads WHERE account_id = \? AND channel = 'whatsapp'/.test(s.sql))).toEqual([]);
  }, 120_000);
});

describe('datos de los chats de WhatsApp (Inbox): nada vencido, nada leído', () => {
  it('hasStaleInfo mira dos filas por el índice y refreshAllStaleInfo vuelve sin listar chats', async () => {
    const { account } = await inboxSetup('info');
    const jid = '5491100093101@s.whatsapp.net';
    await ingestWhatsappEvents(account, [message(jid, 'info-1')] as never);
    const stale = new Date(Date.now() - 3_600_000).toISOString();
    expect(await hasStaleInfo(account.id, stale)).toBe(true);
    expect(await refreshAllStaleInfo(new Date(), Date.now() + 10_000)).toBeGreaterThan(0);
    // Ya con datos: no hay nada que pedir y no se listan los chats.
    expect(await hasStaleInfo(account.id, stale)).toBe(false);
    const idle = await recording(() => refreshAllStaleInfo(new Date(), Date.now() + 10_000));
    expect(idle.filter((s) => /FROM inbox_threads WHERE account_id = \? AND channel/.test(s.sql))).toEqual([]);
    // Vencido otra vez: vuelve a pedirlos.
    await getDb().prepare('UPDATE inbox_threads SET info_at = ? WHERE account_id = ?').run('2020-01-01T00:00:00.000Z', account.id);
    expect(await hasStaleInfo(account.id, stale)).toBe(true);
    expect(await refreshAllStaleInfo(new Date(), Date.now() + 10_000)).toBeGreaterThan(0);

    const plan = (
      await planOf(
        `SELECT EXISTS (SELECT 1 FROM inbox_threads WHERE account_id = ? AND info_at IS NULL)
             OR EXISTS (SELECT 1 FROM inbox_threads WHERE account_id = ? AND info_at < ?) AS due`,
        ['a', 'a', stale],
      )
    ).join(' | ');
    expect(plan).toContain('idx_inbox_threads_info (account_id=? AND info_at=?)');
    expect(plan).toContain('idx_inbox_threads_info (account_id=? AND info_at<?)');
  }, 60_000);
});

describe('el webhook de Lines', () => {
  it('ningún evento recorre una tabla, y la libreta se busca por su índice', async () => {
    const { number } = await linesSetup('webhook');
    const { POST } = await import('@/app/api/groups/webhook/[id]/[secret]/route');
    const dm = '5491100093201@s.whatsapp.net';
    const group = '120363000000093201@g.us';
    const batches: unknown[][] = [
      [message(dm, 'w-1')],
      [message(dm, 'w-2')],
      [message(dm, 'w-2')],
      [message(dm, 'w-3', { fromMe: true })],
      [{ type: 'status', providerMessageId: 'w-3', status: 'delivered' }],
      [{ type: 'presence', chatId: dm, state: 'composing', who: '5491100093201' }],
      [{ type: 'contact', chatId: dm, name: 'Vera Prueba' }],
      [{ type: 'contact', chatId: dm, name: 'Vera Prueba' }],
      [{ type: 'archive', chatId: dm, archived: true }],
      [message(group, 'w-4')],
      [message(group, 'w-5')],
      [],
    ];
    const offenders: string[] = [];
    const counts: number[] = [];
    for (const events of batches) {
      const seen = await recording(async () => {
        const res = await POST(new Request('http://zerosoft.test/api/groups/webhook/x/y', { method: 'POST', body: JSON.stringify({ events }) }), {
          params: Promise.resolve({ id: number.id, secret: number.webhook_secret }),
        });
        expect(res.status).toBe(200);
      });
      counts.push(seen.length);
      offenders.push(...(await scansOf(seen)));
    }
    expect(offenders).toEqual([]);
    // Un mensaje a un chat que ya existe lee los ajustes del workspace una sola vez.
    const again = await recording(() => ingestEvents(number, [message(dm, 'w-6'), message(dm, 'w-7')]));
    expect(again.filter((s) => /SELECT data FROM groups_settings WHERE user_id = \?/.test(s.sql))).toHaveLength(1);
    // Estado, presencia y tanda vacía: la fila del número y poco más.
    expect(counts[4]).toBeLessThanOrEqual(3);
    expect(counts[5]).toBeLessThanOrEqual(2);
    expect(counts[11]).toBeLessThanOrEqual(1);
  }, 60_000);

  it('la libreta de WhatsApp: guardar y buscar un contacto usa los índices por teléfono y por lid', async () => {
    const remember = (
      await planOf(
        `SELECT * FROM wa_contacts WHERE app = ? AND account_id = ? AND phone = ? AND ? <> ''
           UNION
           SELECT * FROM wa_contacts WHERE app = ? AND account_id = ? AND lid = ? AND ? <> ''
           LIMIT 4`,
        ['lines', 'n', '5491100093301', '5491100093301', 'lines', 'n', '', ''],
      )
    ).join(' | ');
    expect(remember).toContain('idx_wa_contacts_acct_phone (app=? AND account_id=? AND phone=?)');
    expect(remember).toContain('idx_wa_contacts_acct_lid (app=? AND account_id=? AND lid=?)');
    const lookup = await planOf(
      `SELECT * FROM wa_contacts WHERE app = ? AND account_id = ? AND phone IN (?,?)
         UNION
         SELECT * FROM wa_contacts WHERE app = ? AND account_id = ? AND lid IN (?,?)`,
      ['lines', 'n', '1', '2', 'lines', 'n', '1', '2'],
    );
    expect(tableScans(lookup)).toEqual([]);
    expect(lookup.join(' | ')).toContain('idx_wa_contacts_acct_phone (app=? AND account_id=? AND phone=?)');
    expect(lookup.join(' | ')).toContain('idx_wa_contacts_acct_lid (app=? AND account_id=? AND lid=?)');
    const name = await planOf(
      `SELECT CASE WHEN w.saved_name <> '' THEN w.saved_name ELSE w.push_name END FROM wa_contacts w WHERE w.app = 'lines' AND w.account_id = ? AND w.phone = ? LIMIT 1`,
      ['n', '1'],
    );
    expect(name.join(' | ')).toContain('idx_wa_contacts_acct_phone (app=? AND account_id=? AND phone=?)');
    const members = await planOf(
      `UPDATE groups_members SET name = ? WHERE phone = ? AND name = ''
           AND EXISTS (SELECT 1 FROM groups_chats c WHERE c.id = groups_members.chat_id AND c.number_id = ?)`,
      ['Vera', '1', 'n'],
    );
    expect(members.join(' | ')).toContain('idx_groups_members_phone (phone=?)');
  });

  it('la libreta sigue juntando la fila del lid con la del teléfono', async () => {
    const u = await makeUser('libreta');
    const scope = { app: 'lines' as const, accountId: `acct-${u.id}`, userId: u.id };
    await rememberContacts(scope, [{ lid: '200000000093401', push: 'Vera' }]);
    await rememberContacts(scope, [{ phone: '5491100093401', saved: 'Vera Prueba' }]);
    // Llega la relación lid ↔ teléfono: quedan en una sola fila con los dos nombres.
    await rememberContacts(scope, [{ phone: '5491100093401', lid: '200000000093401' }]);
    const rows = (await getDb().prepare('SELECT phone, lid, saved_name, push_name FROM wa_contacts WHERE account_id = ?').all(scope.accountId)) as Array<Record<string, string>>;
    expect(rows).toEqual([{ phone: '5491100093401', lid: '200000000093401', saved_name: 'Vera Prueba', push_name: 'Vera' }]);
    const found = await lookupContacts(scope, ['200000000093401']);
    expect(found.get('200000000093401')?.phone).toBe('5491100093401');
  });
});

describe('Lines: trabajos del minuto', () => {
  it('sin reglas de asignación, el barrido no lee ningún chat', async () => {
    const { number } = await linesSetup('sin-reglas');
    await ingestEvents(number, [message('5491100093501@s.whatsapp.net', 'sr-1')]);
    const seen = await recording(async () => {
      expect(await sweepAutoAssign()).toBe(0);
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].sql).toContain('FROM groups_assign_rules WHERE enabled = 1');
    const rules = await planOf(seen[0].sql);
    expect(rules.join(' | ')).toContain('idx_groups_assign_rules_enabled');
    const chats = await planOf(
      `SELECT c.user_id, c.id FROM groups_chats c INDEXED BY idx_groups_chats_to_assign
       WHERE c.user_id IN (?,?) AND c.status = 'open' AND c.assigned_to IS NULL AND c.awaiting_since IS NOT NULL
       ORDER BY c.awaiting_since LIMIT ?`,
      ['a', 'b', 100],
    );
    expect(chats.join(' | ')).toContain('idx_groups_chats_to_assign (user_id=?');
  });

  it('HubSpot: las dos consultas parten de los workspaces con HubSpot, no de todos los chats o mensajes', async () => {
    const notes = (
      await planOf(
        `SELECT m.user_id, m.chat_id, substr(m.created_at, 1, 10) AS day, COUNT(*) AS n, MAX(m.created_at) AS last
         FROM groups_hubspot h
         CROSS JOIN groups_messages m ON m.user_id = h.user_id
         JOIN groups_chats c ON c.id = m.chat_id
         JOIN groups_numbers nb ON nb.id = c.number_id AND nb.visibility = 'all'
         WHERE h.token != '' AND h.log_notes = 1 AND m.created_at >= ? AND m.direction IN ('in', 'out') AND m.deleted_at IS NULL
           AND EXISTS (SELECT 1 FROM groups_hubspot_links l WHERE l.chat_id = m.chat_id AND l.missing = 0)
         GROUP BY m.user_id, m.chat_id, substr(m.created_at, 1, 10)
         ORDER BY last LIMIT 500`,
        ['2026-11-10'],
      )
    ).join(' | ');
    expect(notes).toContain('idx_groups_hubspot_connected');
    expect(notes).toContain('idx_groups_messages_user (user_id=? AND created_at>?)');
    const link = (
      await planOf(
        `SELECT c.id, c.user_id, c.kind, c.phone FROM groups_hubspot h CROSS JOIN groups_chats c ON c.user_id = h.user_id
         WHERE h.token != '' AND h.auto_link = 1 AND c.kind = 'dm' AND c.phone != '' AND c.hidden_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM groups_hubspot_links l WHERE l.chat_id = c.id AND l.object_type = 'contact')
           AND NOT EXISTS (SELECT 1 FROM groups_hubspot_matches m WHERE m.chat_id = c.id)
         ORDER BY COALESCE(c.last_message_at, c.created_at) DESC LIMIT ?`,
        [10],
      )
    ).join(' | ');
    expect(link).toContain('idx_groups_hubspot_connected');
    expect(link).toMatch(/SEARCH c USING INDEX \w+ \(user_id=\?/);
    // Sin HubSpot conectado no devuelven nada.
    const { sweepHubspotAutoLink, syncHubspotNotes } = await import('@/lib/groups-hubspot');
    expect(await sweepHubspotAutoLink()).toBe(0);
    expect(await syncHubspotNotes()).toBe(0);
  });

  it('recordatorios de tareas de Lines: parte de las tareas de los chats, no de todas las actividades del CRM', async () => {
    const { fireTaskReminders } = await import('@/lib/groups-tasks');
    const seen = await recording(() => fireTaskReminders());
    const plan = (await planOf(seen[0].sql, seen[0].args)).join(' | ');
    expect(plan).toMatch(/SCAN t\b/);
    expect(plan).toMatch(/SEARCH a USING INDEX sqlite_autoindex_crm_activities_1 \(id=\?\)/);
  });
});

describe('limpiezas y vencimientos por índice', () => {
  const expectIndex = async (sql: string, args: InValue[], index: string) => {
    const plan = await planOf(sql, args);
    expect(tableScans(plan), sql).toEqual([]);
    expect(plan.join(' | '), sql).toContain(index);
  };

  it('cada consulta usa su índice', async () => {
    const t = '2026-11-11T00:00:00.000Z';
    await expectIndex('DELETE FROM chat_events WHERE id IN (SELECT id FROM chat_events WHERE created_at < ? ORDER BY created_at LIMIT 5000)', [t], 'idx_chat_events_created (created_at<?)');
    await expectIndex('DELETE FROM talk_events WHERE created_at < ?', [t], 'idx_talk_events_created (created_at<?)');
    await expectIndex(`DELETE FROM talk_events WHERE ${TALK_EPHEMERAL_KINDS} AND kind = 'typing' AND created_at < ?`, [t], 'idx_talk_events_ephemeral (created_at<?)');
    await expectIndex(`DELETE FROM talk_events WHERE ${TALK_EPHEMERAL_KINDS} AND kind IN ('signal', 'ephemeral') AND created_at < ?`, [t], 'idx_talk_events_ephemeral (created_at<?)');
    await expectIndex('DELETE FROM talk_command_responses WHERE expires_at < ?', [t], 'idx_talk_command_responses_expires');
    await expectIndex('SELECT session_id, version_id, email, refs FROM send_download_cache WHERE expires_at < ? LIMIT 50', [1], 'idx_send_download_cache_expires');
    await expectIndex('SELECT * FROM send_links WHERE alert_digest > 0 AND alert_window_at < ? AND deleted_at IS NULL LIMIT 50', [t], 'idx_send_links_digest_due');
    await expectIndex('DELETE FROM send_sessions WHERE expires_at < ?', [t], 'idx_send_sessions_expires');
    await expectIndex('DELETE FROM send_email_codes WHERE expires_at < ?', [t], 'idx_send_email_codes_expires');
    await expectIndex("UPDATE chat_campaign_recipients SET status = 'failed' WHERE status = 'claimed' AND claimed_at < ?", [t], 'idx_chat_campaign_rec_claimed');
    await expectIndex("SELECT id FROM voice_sessions WHERE notes_status = 'queued' ORDER BY updated_at LIMIT 20", [], 'idx_voice_sessions_notes_queued');
    await expectIndex("SELECT id FROM rec_videos WHERE status = 'recording' AND created_at < ? LIMIT ?", [t, 5], 'idx_rec_videos_recording');
    await expectIndex("SELECT id FROM calls WHERE status IN ('skipped', 'cancelled') AND updated_at < ? LIMIT 200", [t], 'idx_calls_status_updated (status=? AND updated_at<?)');
    await expectIndex('DELETE FROM social_oauth_states WHERE expires_at < ?', [t], 'idx_social_oauth_states_expires');
    await expectIndex('DELETE FROM social_webhook_events WHERE created_at < ?', [t], 'idx_social_webhook_events_created');
    await expectIndex("SELECT id, url FROM agent_knowledge_urls WHERE status = 'pending' AND fetched_at IS NULL ORDER BY created_at LIMIT ?", [15], 'idx_agent_knowledge_urls_pending');
    await expectIndex('SELECT chat_id, day FROM groups_hubspot_notes WHERE day >= ?', ['2026-11-10'], 'idx_groups_hubspot_notes_day');
    await expectIndex('DELETE FROM groups_hubspot_sync_log WHERE created_at < ?', [t], 'idx_groups_hubspot_sync_log_created');
    await expectIndex(
      `SELECT r.id, r.user_id, r.replay_at FROM flow_runs r INDEXED BY idx_flow_runs_replay JOIN flow_flows f ON f.id = r.flow_id
       WHERE r.replay_at IS NOT NULL AND r.replay_at <= ? AND r.status = 'failed' AND f.enabled = 1 ORDER BY r.replay_at LIMIT ?`,
      [t, 20],
      'idx_flow_runs_replay',
    );
    await expectIndex(
      `UPDATE flow_runs INDEXED BY idx_flow_runs_replay SET replay_at = NULL WHERE replay_at IS NOT NULL AND replay_at <= ?
         AND EXISTS (SELECT 1 FROM flow_flows f WHERE f.id = flow_runs.flow_id AND f.enabled = 0)`,
      [t],
      'idx_flow_runs_replay',
    );
  });

  it('el aviso de respuestas sin leer de Chat sale del índice de pendientes', async () => {
    const { sendOfflineReplyEmails } = await import('@/lib/chat-offline-email');
    const seen = await recording(() => sendOfflineReplyEmails({ limit: 200 }));
    const plan = (await planOf(seen[0].sql, seen[0].args)).join(' | ');
    expect(plan).toContain('idx_chat_messages_offline_due (created_at>?)');
  });

  it('los SLA de Track salen de los dos índices de vencidos, y siguen avisando', async () => {
    const seen = await recording(() => runSlaChecks({ limit: 200 }));
    const plan = (await planOf(seen[0].sql, seen[0].args)).join(' | ');
    expect(plan).toContain('idx_track_issue_slas_risk_due (risk_at<?)');
    expect(plan).toContain('idx_track_issue_slas_breach_due (due_at<?)');
    expect(plan).not.toContain('idx_track_issue_slas_open');
  });

  it('pruneChatEvents borra solo lo de más de una hora', async () => {
    const db = getDb();
    const u = await makeUser('chat-eventos');
    const stamp = (ms: number) => new Date(Date.now() - ms).toISOString().replace('T', ' ').slice(0, 19);
    const widget = `w-${u.id}`;
    await db.prepare('INSERT INTO chat_events (conversation_id, widget_id, created_at) VALUES (?, ?, ?)').run('c-viejo', widget, stamp(2 * 3_600_000));
    await db.prepare('INSERT INTO chat_events (conversation_id, widget_id, created_at) VALUES (?, ?, ?)').run('c-nuevo', widget, stamp(60_000));
    expect(await pruneChatEvents()).toBeGreaterThanOrEqual(1);
    const left = (await db.prepare('SELECT conversation_id FROM chat_events WHERE widget_id = ?').all(widget)) as Array<{ conversation_id: string }>;
    expect(left.map((r) => r.conversation_id)).toEqual(['c-nuevo']);
    expect(await pruneChatEvents()).toBe(0);
  });

  it('Talk: los eventos efímeros se borran con el mismo corte de siempre', async () => {
    const db = getDb();
    const u = await makeUser('talk-eventos');
    const add = (kind: string, agoMs: number) =>
      db.prepare("INSERT INTO talk_events (workspace_id, kind, payload, created_at) VALUES (?, ?, '{}', ?)").run(u.id, kind, new Date(Date.now() - agoMs).toISOString());
    await add('typing', 11 * 60_000);
    await add('typing', 6 * 60_000);
    await add('signal', 6 * 60_000);
    await add('signal', 60_000);
    await add('message', 2 * 3_600_000);
    await add('message', 25 * 3_600_000);
    const { runTalkCron } = await import('@/lib/talk-notify');
    await runTalkCron();
    const left = (await db.prepare('SELECT kind, COUNT(*) AS n FROM talk_events WHERE workspace_id = ? GROUP BY kind ORDER BY kind').all(u.id)) as Array<{ kind: string; n: number }>;
    expect(left).toEqual([
      { kind: 'message', n: 1 },
      { kind: 'signal', n: 1 },
      { kind: 'typing', n: 1 },
    ]);
  });
});

describe('la campana de avisos', () => {
  const notify = (userId: string, n: number) =>
    createNotification({ userId, type: 'mention', title: `Aviso ${n}`, href: `/app/track/issues/i-${n}`, sourceType: 'track_issue', sourceId: `i-${n}` });

  const get = async (etag?: string, query = '?limit=5') => {
    const { GET } = await import('@/app/api/notifications/route');
    return GET(new NextRequest(`http://zerosoft.test/api/notifications${query}`, { headers: etag ? { 'if-none-match': etag } : {} }));
  };

  it('la versión sube con cada cambio en los avisos de la persona (y solo de esa persona)', async () => {
    const a = await makeUser('rev-a');
    const b = await makeUser('rev-b');
    expect(await notificationRev(a.id)).toBe(0);
    const n = await notify(a.id, 1);
    expect(await notificationRev(a.id)).toBe(1);
    await notify(a.id, 2);
    await markAllNotificationsRead(a.id);
    expect(await notificationRev(a.id)).toBe(4);
    await getDb().prepare('DELETE FROM notifications WHERE id = ?').run(n.id);
    expect(await notificationRev(a.id)).toBe(5);
    expect(await notificationRev(b.id)).toBe(0);
  });

  it('sin cambios responde 304 leyendo una fila; con un aviso nuevo, 200 con los datos', async () => {
    const u = await makeUser('campana');
    session.user = { id: u.id, email: u.email };
    await notify(u.id, 1);
    const first = await get();
    expect(first.status).toBe(200);
    const tag = first.headers.get('etag')!;
    expect(tag).toMatch(/^W\/"n1\.0\./);
    expect(((await first.json()) as { unreadCount: number }).unreadCount).toBe(1);

    let same!: Response;
    const seen = await recording(async () => {
      same = await get(tag);
    });
    expect(same.status).toBe(304);
    expect(same.headers.get('etag')).toBe(tag);
    expect(same.headers.get('cache-control')).toBe('private, no-store');
    expect(seen.map((s) => s.sql)).toEqual(['SELECT rev FROM notification_rev WHERE user_id = ?']);

    await notify(u.id, 2);
    const fresh = await get(tag);
    expect(fresh.status).toBe(200);
    expect(fresh.headers.get('etag')).not.toBe(tag);
    const body = (await fresh.json()) as { rows: Array<{ title: string }>; unreadCount: number };
    expect(body.unreadCount).toBe(2);
    expect(body.rows.map((r) => r.title)).toEqual(['Aviso 2', 'Aviso 1']);
    // Otro pedido (otros filtros) no comparte la respuesta.
    expect((await get(fresh.headers.get('etag')!, '?limit=20&unreadOnly=1')).status).toBe(200);
    // Ni otra persona con el ETag de esta.
    const other = await makeUser('campana-otra');
    session.user = { id: other.id, email: other.email };
    expect((await get(fresh.headers.get('etag')!)).status).toBe(200);
  });

  it('un aviso pospuesto vuelve a su hora: el ETag deja de valer en ese momento', async () => {
    const u = await makeUser('pospuesto');
    session.user = { id: u.id, email: u.email };
    const n = await notify(u.id, 1);
    const until = new Date(Date.now() + 3_600_000);
    expect(await snoozeNotification(n.id, u.id, until.toISOString())).toBe(true);
    expect(await nextSnoozeWake(u.id)).toBe(until.getTime());
    const res = await get();
    const tag = res.headers.get('etag')!;
    expect(((await res.json()) as { unreadCount: number }).unreadCount).toBe(0);
    expect(tag).toContain(`.${until.getTime()}.`);
    const rev = await notificationRev(u.id);
    const key = notificationKey(u.id, '?limit=5', []);
    expect(notificationTagFresh(tag, rev, key, until.getTime() - 1)).toBe(true);
    expect(notificationTagFresh(tag, rev, key, until.getTime())).toBe(false);
    expect((await get(tag)).status).toBe(304);
    // Ya volvió (sin que nadie escriba nada): el mismo ETag ya no sirve y el aviso cuenta.
    await getDb().prepare('UPDATE notification_rev SET rev = rev WHERE user_id = ?').run(u.id);
    vi.useFakeTimers({ now: until.getTime() + 1000, toFake: ['Date'] });
    try {
      const back = await get(tag);
      expect(back.status).toBe(200);
      expect(((await back.json()) as { unreadCount: number }).unreadCount).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('notificationTagFresh: versión, pedido y hora', () => {
    const tag = notificationTag(7, 0, 'abc');
    expect(notificationTagFresh(tag, 7, 'abc')).toBe(true);
    expect(notificationTagFresh(`"otro", ${tag}`, 7, 'abc')).toBe(true);
    expect(notificationTagFresh(tag, 8, 'abc')).toBe(false);
    expect(notificationTagFresh(tag, 7, 'abd')).toBe(false);
    expect(notificationTagFresh(null, 7, 'abc')).toBe(false);
    expect(notificationTagFresh('W/"cualquier-cosa"', 7, 'abc')).toBe(false);
    expect(notificationKey('u', '?limit=5', ['/app/crm', '/app/track'])).toBe(notificationKey('u', '?limit=5', ['/app/track', '/app/crm']));
    expect(notificationKey('u', '?limit=5', ['/app/crm'])).not.toBe(notificationKey('u', '?limit=5', []));
  });

  it('la lista, los sin leer y el próximo pospuesto salen de sus índices', async () => {
    const now = new Date().toISOString();
    const list = await planOf(
      'SELECT * FROM notifications WHERE user_id = ? AND (snoozed_until IS NULL OR snoozed_until <= ?) ORDER BY COALESCE(snoozed_until, created_at) DESC LIMIT ? OFFSET ?',
      ['u', now, 5, 0],
    );
    expect(list.join(' | ')).toContain('idx_notifications_user_recent (user_id=?)');
    expect(list.join(' | ')).not.toContain('TEMP B-TREE');
    const count = await planOf('SELECT COUNT(*) AS c FROM notifications INDEXED BY idx_notifications_unread WHERE user_id = ? AND read_at IS NULL AND (snoozed_until IS NULL OR snoozed_until <= ?)', ['u', now]);
    expect(count.join(' | ')).toContain('COVERING INDEX idx_notifications_unread (user_id=?)');
    const wake = await planOf('SELECT MIN(snoozed_until) AS at FROM notifications WHERE user_id = ? AND snoozed_until > ?', ['u', now]);
    expect(wake.join(' | ')).toContain('idx_notifications_snoozed (user_id=? AND snoozed_until>?)');
    const rev = await planOf('SELECT rev FROM notification_rev WHERE user_id = ?', ['u']);
    expect(rev.join(' | ')).toMatch(/SEARCH notification_rev USING (COVERING )?INDEX sqlite_autoindex_notification_rev_1 \(user_id=\?\)/);
  });
});

describe('cada cuánto consulta la campana', () => {
  it('oculta nunca; con foco siempre; a la vista sin foco, recién cuando pasó el intervalo largo', () => {
    expect(pollDue({ visible: false, focused: false, sinceLastMs: 10 * 60_000 }, 120_000)).toBe(false);
    expect(pollDue({ visible: false, focused: true, sinceLastMs: 10 * 60_000 }, 120_000)).toBe(false);
    expect(pollDue({ visible: true, focused: true, sinceLastMs: 30_000 }, 120_000)).toBe(true);
    expect(pollDue({ visible: true, focused: false, sinceLastMs: 30_000 }, 120_000)).toBe(false);
    expect(pollDue({ visible: true, focused: false, sinceLastMs: 119_000 }, 120_000)).toBe(false);
    expect(pollDue({ visible: true, focused: false, sinceLastMs: 120_000 }, 120_000)).toBe(true);
    // Sin intervalo largo (los que no lo piden): como antes, alcanza con estar a la vista.
    expect(pollDue({ visible: true, focused: false, sinceLastMs: 0 })).toBe(true);
  });

  it('después de pedidos fallidos espera el doble cada vez, con tope', () => {
    expect(failureBackoffMs(0, 30_000, 300_000)).toBe(0);
    expect(failureBackoffMs(1, 30_000, 300_000)).toBe(30_000);
    expect(failureBackoffMs(2, 30_000, 300_000)).toBe(60_000);
    expect(failureBackoffMs(3, 30_000, 300_000)).toBe(120_000);
    expect(failureBackoffMs(5, 30_000, 300_000)).toBe(300_000);
    expect(failureBackoffMs(50, 30_000, 300_000)).toBe(300_000);
  });
});
