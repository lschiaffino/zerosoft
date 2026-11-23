/**
 * Secuencias: cuando quien envía sale del workspace, sus inscripciones se
 * pausan y el owner recibe un solo aviso por secuencia mientras no lo lea,
 * aunque varias inscripciones se pausen a la vez. Nadie más lo recibe
 * (miembros, admins ni otro workspace). Datos inventados.
 */
import { describe, expect, it } from 'vitest';
import { createContact } from '@/lib/crm';
import { createSequence, enrollContacts, processEnrollment, SENDER_LEFT } from '@/lib/crm-sequences';
import { createNotification, createNotificationUnlessUnread } from '@/lib/notifications';
import { addMember, removeMember } from '@/lib/teams';
import { getDb } from '@/lib/db';
import { workspaceWithMember } from './access-helpers';
import { makeUser } from './helpers';

type Enrollment = Parameters<typeof processEnrollment>[0];

async function seed(label: string, contacts = 4) {
  const w = await workspaceWithMember(label);
  const ws = w.owner.id;
  const admin = await makeUser(`${label}-admin`);
  await addMember(w.team.id, admin.id, 'admin');
  const seq = await createSequence(ws, ws, {
    name: 'Follow-up',
    timezone: 'UTC',
    windowStart: '00:00',
    windowEnd: '23:59',
    businessDays: false,
    steps: [{ type: 'task', subject: 'Call back' }],
  });
  const ids: string[] = [];
  for (let i = 0; i < contacts; i++) {
    const c = await createContact(ws, { firstName: `C${i}`, email: `c${i}-${label}@client.test`, ownerId: w.member.id });
    ids.push(c.id);
  }
  expect(await enrollContacts(ws, { sequenceId: seq.id, contactIds: ids, senderId: w.member.id, enrolledBy: ws })).toMatchObject({ ok: true });
  return { w, ws, admin, seq };
}

const enrollments = async (ws: string, seqId: string) =>
  (await getDb().prepare('SELECT * FROM crm_sequence_enrollments WHERE user_id = ? AND sequence_id = ?').all(ws, seqId)) as Enrollment[];
const notices = async (seqId: string) =>
  (await getDb()
    .prepare("SELECT id, user_id, read_at FROM notifications WHERE type = 'crm_sequence' AND source_type = 'crm_sequence' AND source_id = ?")
    .all(seqId)) as Array<{ id: string; user_id: string; read_at: string | null }>;

describe('aviso de remitente que salió: uno por secuencia aunque se pausen varias a la vez', () => {
  it('varias inscripciones pausadas en paralelo dejan un solo aviso, solo para el owner', async () => {
    const s = await seed('seqleft-par');
    await removeMember(s.w.team.id, s.w.member.id);
    const outcomes = await Promise.all((await enrollments(s.ws, s.seq.id)).map((e) => processEnrollment(e)));
    expect(outcomes).toEqual(['paused', 'paused', 'paused', 'paused']);
    const list = await notices(s.seq.id);
    expect(list.map((n) => n.user_id)).toEqual([s.ws]);
    // Ni el member que salió, ni el admin, ni otro workspace.
    for (const other of [s.w.member.id, s.admin.id, s.w.friend.id, s.w.stranger.id]) {
      expect(list.some((n) => n.user_id === other)).toBe(false);
    }
    for (const e of await enrollments(s.ws, s.seq.id)) expect(e).toMatchObject({ status: 'paused', exit_reason: SENDER_LEFT });
  });

  it('leído el aviso, la próxima pausa avisa de nuevo una sola vez', async () => {
    const s = await seed('seqleft-read', 3);
    await removeMember(s.w.team.id, s.w.member.id);
    const rows = await enrollments(s.ws, s.seq.id);
    await processEnrollment(rows[0]);
    const [first] = await notices(s.seq.id);
    // Sin leer: otra pausa no suma avisos.
    await processEnrollment(rows[1]);
    expect(await notices(s.seq.id)).toHaveLength(1);
    await getDb().prepare('UPDATE notifications SET read_at = ? WHERE id = ?').run(new Date().toISOString(), first.id);
    await Promise.all([processEnrollment(rows[1]), processEnrollment(rows[2])]);
    const after = await notices(s.seq.id);
    expect(after).toHaveLength(2);
    expect(after.filter((n) => n.read_at === null)).toHaveLength(1);
  });

  it('createNotificationUnlessUnread: uno por destinatario y origen, y no mira otros orígenes ni destinatarios', async () => {
    const a = await makeUser('seqleft-a');
    const b = await makeUser('seqleft-b');
    const base = { type: 'crm_sequence' as const, title: 'T', sourceType: 'crm_sequence', sourceId: `src-${a.id}` };
    const made = await Promise.all([1, 2, 3, 4, 5].map(() => createNotificationUnlessUnread({ ...base, userId: a.id })));
    expect(made.filter(Boolean)).toHaveLength(1);
    // Otro destinatario y otro origen sí reciben el suyo.
    expect(await createNotificationUnlessUnread({ ...base, userId: b.id })).not.toBeNull();
    expect(await createNotificationUnlessUnread({ ...base, userId: a.id, sourceId: `other-${a.id}` })).not.toBeNull();
    // Uno creado por el camino de siempre también cuenta como pendiente.
    await createNotification({ ...base, userId: b.id, sourceId: `plain-${b.id}` });
    expect(await createNotificationUnlessUnread({ ...base, userId: b.id, sourceId: `plain-${b.id}` })).toBeNull();
  });
});
