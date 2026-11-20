/**
 * `wa-media-audit` (lib/wa-media-audit.ts): cuenta, por línea, los archivos de WhatsApp que ya tienen copia en
 * zerosoft, los que se pueden volver a bajar con la clave guardada y los que dependen de la fila de Evolution, por
 * antigüedad; marca las instancias del servidor que ninguna línea usa. Solo lee. Datos inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getClient, getDb } from '@/lib/db';
import { createAccount, upsertThread } from '@/lib/inbox/core';
import { createNumber } from '@/lib/groups';
import { seal } from '@/lib/secret-box';
import { mediaAuditLine, mediaAuditStep, newMediaAuditState, parseInstances, type RawInstance } from '@/lib/wa-media-audit';
import { parseMaintenanceJobs, runMaintenanceJobs } from '@/lib/maintenance-jobs';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const uniq = () => Math.random().toString(36).slice(2, 10);
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const INBOX_SESSION = `zs-${'1'.repeat(20)}`;
const LINES_SESSION = `zs-${'2'.repeat(20)}`;
const OLD_SESSION = `zs-a1c79${'0'.repeat(15)}`;
const PHONE = '5491155550123';

async function fixture() {
  const u = await makeUser(`mau-${uniq()}`);
  const acc = await createAccount(u.id, { kind: 'whatsapp', provider: 'managed', label: 'WhatsApp' });
  await getDb().prepare("UPDATE inbox_accounts SET status = 'connected', config = ? WHERE id = ?").run(seal(JSON.stringify({ session: INBOX_SESSION, instanceToken: 't'.repeat(48) })), acc.id);
  const thread = await upsertThread(acc, { externalId: `${PHONE}@s.whatsapp.net`, kind: 'dm', handle: PHONE });
  const ref = (wire: boolean) => JSON.stringify({ providerMessageId: uniq(), chatId: `${PHONE}@s.whatsapp.net`, fromMe: false, ...(wire ? { wire: 'sealed' } : {}) });
  const inboxMsg = async (days: number, opts: { wire?: boolean; stored?: boolean; revoked?: boolean } = {}) => {
    const id = `im_${uniq()}`;
    await getDb()
      .prepare(
        `INSERT INTO inbox_messages (id, owner_id, thread_id, external_id, media_type, media_ref, revoked_at, sent_at, created_at) VALUES (?, ?, ?, ?, 'image', ?, ?, ?, ?)`,
      )
      .run(id, u.id, thread.id, uniq(), ref(!!opts.wire), opts.revoked ? ago(0) : null, ago(days), ago(days));
    if (opts.stored) {
      await getDb()
        .prepare('INSERT INTO inbox_media_files (message_id, owner_id, file_ref, mime, filename, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, u.id, `local:${uniq()}`, 'image/jpeg', '', 10, ago(0));
    }
  };
  // Inbox: reciente guardado, reciente con clave, 60 días sin nada, 120 días sin nada, uno revocado (no cuenta) y un texto (no cuenta).
  await inboxMsg(1, { stored: true });
  await inboxMsg(2, { wire: true });
  await inboxMsg(60);
  await inboxMsg(120);
  await inboxMsg(120, { revoked: true });
  await getDb()
    .prepare(`INSERT INTO inbox_messages (id, owner_id, thread_id, external_id, body, sent_at, created_at) VALUES (?, ?, ?, ?, 'hola', ?, ?)`)
    .run(`im_${uniq()}`, u.id, thread.id, uniq(), ago(1), ago(1));

  const n = await createNumber(u.id, u.id, { provider: 'fake' });
  await getDb().prepare("UPDATE groups_numbers SET provider = 'managed', status = 'connected', config = ? WHERE id = ?").run(seal(JSON.stringify({ session: LINES_SESSION })), n.id);
  const chat = `gc_${uniq()}`;
  await getDb()
    .prepare("INSERT INTO groups_chats (id, user_id, number_id, provider_chat_id, kind, name, phone, created_at, updated_at) VALUES (?, ?, ?, ?, 'dm', '', '', ?, ?)")
    .run(chat, u.id, n.id, `${PHONE}@s.whatsapp.net`, ago(0), ago(0));
  const lineMsg = async (days: number, url: string, meta = '') =>
    getDb()
      .prepare(
        `INSERT INTO groups_messages (id, user_id, chat_id, number_id, provider_message_id, direction, media_url, media_type, status, meta, created_at)
         VALUES (?, ?, ?, ?, ?, 'in', ?, 'image', 'received', ?, ?)`,
      )
      .run(`gm_${uniq()}`, u.id, chat, n.id, uniq(), url, meta, ago(days));
  // Lines: guardado viejo, pendiente con clave de 40 días, pendiente sin clave reciente, perdido ('') de 100 días.
  await lineMsg(200, '/api/files/abc');
  await lineMsg(40, 'evo:x', JSON.stringify({ mediaWire: 'sealed' }));
  await lineMsg(3, 'evo:y');
  await lineMsg(100, '');
  return { acc, n };
}

const instances = async (): Promise<RawInstance[]> => [
  { server: 'lines', name: INBOX_SESSION, status: 'open', messages: 500, contacts: 20, chats: 10 },
  { server: 'lines', name: LINES_SESSION, status: 'open', messages: 300, contacts: 5, chats: 3 },
  { server: 'lines', name: OLD_SESSION, status: 'close', messages: 90_000, contacts: 900, chats: 400 },
];

describe('wa-media-audit', () => {
  it('cuenta por línea y antigüedad, y marca la instancia que ninguna línea usa', async () => {
    const { acc, n } = await fixture();
    const s = newMediaAuditState();
    expect(await mediaAuditStep(s, { deadline: Date.now() + 10_000, deps: { instances, only: [acc.id, n.id] } })).toBe(true);

    const inbox = s.lines.find((l) => l.app === 'inbox')!;
    expect(inbox).toMatchObject({ id: acc.id, provider: 'managed', status: 'connected', instance: 'zs-11111' });
    expect(inbox.total).toEqual({ recent: 2, mid: 1, old: 1 });
    expect(inbox.stored).toEqual({ recent: 1, mid: 0, old: 0 });
    expect(inbox.wire).toEqual({ recent: 1, mid: 0, old: 0 });
    expect(inbox.bare).toEqual({ recent: 0, mid: 1, old: 1 });

    const lines = s.lines.find((l) => l.app === 'lines')!;
    expect(lines).toMatchObject({ id: n.id, instance: 'zs-22222' });
    expect(lines.total).toEqual({ recent: 1, mid: 1, old: 2 });
    expect(lines.stored).toEqual({ recent: 0, mid: 0, old: 1 });
    expect(lines.wire).toEqual({ recent: 0, mid: 1, old: 0 });
    expect(lines.bare).toEqual({ recent: 1, mid: 0, old: 1 });

    expect(s.totals.inbox.bare).toEqual(inbox.bare);
    expect(s.instances.map((i) => [i.name, i.usedBy])).toEqual([
      ['zs-11111', 'inbox'],
      ['zs-22222', 'lines'],
      ['zs-a1c79', ''],
    ]);
    const line = mediaAuditLine(s);
    expect(line).toContain('not used by any line: zs-a1c79 close 90000 msgs');
    // Nada del nombre entero de la instancia ni del teléfono, ni en el log ni en lo que se guarda.
    const saved = JSON.stringify(s);
    for (const secret of [INBOX_SESSION, LINES_SESSION, OLD_SESSION, PHONE]) {
      expect(line).not.toContain(secret);
      expect(saved).not.toContain(secret);
    }
  });

  it('si no puede listar las instancias, termina igual y dice por qué', async () => {
    const s = newMediaAuditState();
    const fail = async () => {
      throw new Error('no_server');
    };
    expect(await mediaAuditStep(s, { deadline: Date.now() + 10_000, deps: { instances: fail, only: [] } })).toBe(true);
    expect(s.instancesError).toBe('no_server');
    expect(mediaAuditLine(s)).toContain('instances not listed (no_server)');
  });

  it('de fetchInstances lee solo nombre, estado y cuentas', () => {
    const rows = parseInstances('inbox', [
      { name: 'zs-abc', connectionStatus: 'open', token: 'secreto', ownerJid: `${PHONE}@s.whatsapp.net`, profileName: 'Ana', _count: { Message: 7, Contact: 2, Chat: 1 } },
      { instance: { instanceName: 'zs-def', status: 'close' } },
      { connectionStatus: 'open' },
      'x',
    ]);
    expect(rows).toEqual([
      { server: 'inbox', name: 'zs-abc', status: 'open', messages: 7, contacts: 2, chats: 1 },
      { server: 'inbox', name: 'zs-def', status: 'close', messages: 0, contacts: 0, chats: 0 },
    ]);
    expect(parseInstances('inbox', { error: true })).toEqual([]);
  });

  it('por el cron: solo dry, termina y el informe no lleva teléfonos', async () => {
    expect(parseMaintenanceJobs('wa-media-audit:dry').jobs).toEqual([{ job: 'wa-media-audit', mode: 'dry' }]);
    expect(parseMaintenanceJobs('wa-media-audit:apply').invalid).toEqual(['wa-media-audit:apply']);
    const { acc, n } = await fixture();
    const log: string[] = [];
    const r = await runMaintenanceJobs({ env: 'wa-media-audit:dry', client: getClient(), log: (l) => log.push(l), budgetMs: 10_000, mediaAuditDeps: { instances, only: [acc.id, n.id] } });
    expect(r?.[0]).toMatchObject({ job: 'wa-media-audit', mode: 'dry', status: 'done' });
    expect(log.join('\n')).toMatch(/\[maintenance\] wa-media-audit dry: inbox 4 files: stored 1, wire 1, bare 2/);
    expect(log.join('\n')).not.toContain(PHONE);
    const row = (await getDb().prepare("SELECT report FROM maintenance_jobs WHERE job = 'wa-media-audit' AND mode = 'dry'").get()) as { report: string };
    expect(JSON.parse(row.report).instances).toHaveLength(3);
    expect(row.report).not.toContain(PHONE);
  });
});
