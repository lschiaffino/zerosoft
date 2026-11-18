import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { createCampaign, getCampaign, scheduleCampaign, startDueCampaigns, unscheduleCampaign } from '@/lib/chat-campaigns';
import { mergeVisitorAttributes, parseVisitorAttributes, setCampaignOptIn } from '@/lib/chat-companies';
import { rotateWidgetIdentitySecret, visitorIdentityHash } from '@/lib/chat-identity';
import { createCannedResponse, createChatWidget, getCannedResponse, getOrCreateChatVisitor, updateChatWidget } from '@/lib/chat-data';
import { createChatTeam } from '@/lib/chat-collab';
import { createSnoozeOption, deleteSnoozeOption, listSnoozeOptions, MAX_SNOOZE_MINUTES } from '@/lib/chat-snooze';
import { issueVisitorToken } from '@/lib/chat-visitor-key';
import { makeUser } from './helpers';

type FakeUser = { id: string; email: string; team?: { id: string } | null };
const session = vi.hoisted(() => ({ user: null as null | FakeUser }));
vi.mock('@/lib/session', async (orig) => ({
  ...(await orig<typeof import('@/lib/session')>()),
  getCurrentUser: async () => session.user,
  realUserId: (u: FakeUser) => u.id,
  isWorkspaceAdmin: () => true,
}));
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: (task: () => Promise<void>) => {
    void task().catch(() => {});
  },
}));
vi.mock('@/lib/uploads', async (orig) => ({
  ...(await orig<typeof import('@/lib/uploads')>()),
  saveUpload: async (_folder: string, filename: string) => `/uploads/chat/${filename}`,
}));

const visitorUpload = await import('@/app/api/chat/messages/upload/route');
const visitorMessages = await import('@/app/api/chat/messages/route');
const cannedRoute = await import('@/lib/routes/chat/canned/[id]/route');
const widgetScript = await import('@/app/api/chat/widget.js/route');

let ip = 0;
const nextIp = () => `10.77.${(ip += 1) >> 8}.${ip & 255}`;

function uploadReq(fields: Record<string, string>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  form.set('file', new File(['hola'], 'nota.txt', { type: 'text/plain' }));
  return new Request('http://x/api/chat/messages/upload', { method: 'POST', headers: { 'x-forwarded-for': nextIp() }, body: form });
}

function messageReq(body: unknown) {
  return new Request('http://x/api/chat/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': nextIp() }, body: JSON.stringify(body) });
}

beforeEach(() => {
  session.user = null;
});

describe('quién adjunta archivos en el messenger', () => {
  it('nadie: el servidor lo frena aunque el pedido llegue', async () => {
    const owner = await makeUser('att');
    const w = await createChatWidget(owner.id, null, { name: 'off' });
    await updateChatWidget(w.id, { visitorAttachments: 'none' });
    const res = await visitorUpload.POST(uploadReq({ widgetId: w.id, visitorId: issueVisitorToken(w.id) }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('attachments_off');
  });

  it('solo identidad firmada: sin firma no; con firma sí', async () => {
    const owner = await makeUser('att2');
    const w = await createChatWidget(owner.id, null, { name: 'firmados' });
    const secret = await rotateWidgetIdentitySecret(w.id);
    await updateChatWidget(w.id, { visitorAttachments: 'identified' });
    const visitorId = issueVisitorToken(w.id);
    const declared = await visitorUpload.POST(uploadReq({ widgetId: w.id, visitorId, email: 'a@b.co' }));
    expect(declared.status).toBe(403);
    const wrong = await visitorUpload.POST(uploadReq({ widgetId: w.id, visitorId, email: 'a@b.co', userHash: 'f'.repeat(64) }));
    expect(wrong.status).toBe(403);
    const signed = await visitorUpload.POST(uploadReq({ widgetId: w.id, visitorId, email: 'a@b.co', userHash: visitorIdentityHash(secret, 'a@b.co') }));
    expect(signed.status).toBeLessThan(300);
  });

  it('por defecto se puede, como siempre', async () => {
    const owner = await makeUser('att3');
    const w = await createChatWidget(owner.id, null, { name: 'todos' });
    const res = await visitorUpload.POST(uploadReq({ widgetId: w.id, visitorId: issueVisitorToken(w.id) }));
    expect(res.status).toBeLessThan(300);
  });
});

describe('atributos de la persona desde el sitio', () => {
  it('sin firma no se escriben; con firma se suman a los que había', async () => {
    const owner = await makeUser('attr');
    const w = await createChatWidget(owner.id, null, { name: 'attrs' });
    const secret = await rotateWidgetIdentitySecret(w.id);
    const visitorId = issueVisitorToken(w.id);
    const email = 'plan@test.local';
    await visitorMessages.POST(messageReq({ widgetId: w.id, visitorId, body: 'hola', email, attributes: { plan: 'hackeado' } }));
    const v0 = await getOrCreateChatVisitor(w.id, visitorId);
    expect(parseVisitorAttributes((v0 as unknown as { attributes: string | null }).attributes).plan).toBeUndefined();

    await mergeVisitorAttributes(v0.id, { color: 'azul' });
    await visitorMessages.POST(messageReq({ widgetId: w.id, visitorId, body: 'hola otra vez', email, userHash: visitorIdentityHash(secret, email), attributes: { plan: 'pro', seats: 5, bad: { x: 1 } } }));
    const row = (await getDb().prepare('SELECT attributes FROM chat_visitors WHERE id = ?').get(v0.id)) as { attributes: string };
    expect(parseVisitorAttributes(row.attributes)).toEqual({ color: 'azul', plan: 'pro', seats: '5' });
  });
});

describe('uso de las respuestas guardadas', () => {
  it('cuenta las usadas y no deja tocar las de otro workspace', async () => {
    const owner = await makeUser('canned');
    const other = await makeUser('canned2');
    const w = await createChatWidget(owner.id, null, { name: 'macros' });
    const r = await createCannedResponse(w.id, { shortcut: '/hola', title: 'Hola', body: 'Hola' });
    const ctx = { params: Promise.resolve({ id: r.id }) };
    session.user = { id: other.id, email: other.email };
    expect((await cannedRoute.POST(new Request('http://x', { method: 'POST' }), ctx)).status).toBe(404);
    session.user = { id: owner.id, email: owner.email };
    expect((await cannedRoute.POST(new Request('http://x', { method: 'POST' }), ctx)).status).toBe(200);
    await cannedRoute.POST(new Request('http://x', { method: 'POST' }), ctx);
    const after = (await getCannedResponse(r.id)) as unknown as { use_count: number; last_used_at: string | null };
    expect(after.use_count).toBe(2);
    expect(after.last_used_at).toBeTruthy();
  });
});

describe('opciones propias de posponer', () => {
  it('valida duración y equipo, y cada workspace ve las suyas', async () => {
    const owner = await makeUser('sn');
    const other = await makeUser('sn2');
    await expect(createSnoozeOption(owner.id, { label: '', minutes: 60 })).rejects.toMatchObject({ code: 'missing_name' });
    await expect(createSnoozeOption(owner.id, { label: 'x', minutes: 0 })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(createSnoozeOption(owner.id, { label: 'x', minutes: MAX_SNOOZE_MINUTES + 1 })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(createSnoozeOption(owner.id, { label: 'x', minutes: 60, team_id: 'no-existe' })).rejects.toMatchObject({ code: 'invalid_input' });
    const o = await createSnoozeOption(owner.id, { label: 'Dos días', minutes: 2880 });
    expect((await listSnoozeOptions(owner.id, null)).map((x) => x.id)).toContain(o.id);
    expect(await listSnoozeOptions(other.id, null)).toEqual([]);
    expect(await deleteSnoozeOption(other.id, o.id)).toBe(false);
    expect(await deleteSnoozeOption(owner.id, o.id)).toBe(true);
  });

  it('las de un equipo solo las ven sus miembros', async () => {
    const owner = await makeUser('sn3');
    const inTeam = await makeUser('sn4');
    const outTeam = await makeUser('sn5');
    const team = await createChatTeam(owner.id, { name: 'Soporte' }, [owner.id]);
    // La pertenencia se sincroniza con los grupos del workspace: acá se anota directo.
    await getDb().prepare("INSERT INTO chat_team_members (team_id, user_id, created_at) VALUES (?, ?, datetime('now'))").run(team.id, inTeam.id);
    const o = await createSnoozeOption(owner.id, { label: 'Turno', minutes: 480, team_id: team.id });
    expect((await listSnoozeOptions(owner.id, inTeam.id)).map((x) => x.id)).toContain(o.id);
    expect((await listSnoozeOptions(owner.id, outTeam.id)).map((x) => x.id)).not.toContain(o.id);
  });
});

describe('campañas programadas', () => {
  // Otras pruebas comparten la base y corren el envío del cron: no quedan campañas de acá en curso.
  const made: string[] = [];
  afterEach(async () => {
    for (const id of made.splice(0)) {
      await getDb().prepare('DELETE FROM chat_campaign_recipients WHERE campaign_id = ?').run(id);
      await getDb().prepare('DELETE FROM chat_campaigns WHERE id = ?').run(id);
    }
  });
  async function draft(label: string) {
    const owner = await makeUser(label);
    const w = await createChatWidget(owner.id, null, { name: label });
    const v = await getOrCreateChatVisitor(w.id, `ext-${crypto.randomUUID()}`, { email: `${label}@people.test`, name: 'P' });
    await setCampaignOptIn(v.id, true);
    const c = await createCampaign(owner.id, owner.id, { name: 'Novedades', widget_id: w.id, subject: 'Hola', body: 'Texto', audience: 'all' });
    made.push(c.id);
    return { owner, w, v, c };
  }

  it('no acepta el pasado ni más de 90 días, y sin destinatarios avisa antes', async () => {
    const { owner, c } = await draft('sc1');
    const now = new Date('2026-11-01T12:00:00Z');
    await expect(scheduleCampaign(owner.id, c.id, '2026-11-01T11:00:00Z', now)).rejects.toMatchObject({ code: 'invalid_schedule' });
    await expect(scheduleCampaign(owner.id, c.id, '2027-06-01T11:00:00Z', now)).rejects.toMatchObject({ code: 'invalid_schedule' });
    await expect(scheduleCampaign(owner.id, c.id, 'mañana', now)).rejects.toMatchObject({ code: 'invalid_schedule' });
    const w2 = await createChatWidget(owner.id, null, { name: 'vacio' });
    const empty = await createCampaign(owner.id, owner.id, { name: 'Vacía', widget_id: w2.id, subject: 'Hola', body: 'Texto', audience: 'all' });
    await expect(scheduleCampaign(owner.id, empty.id, '2026-11-02T11:00:00Z', now)).rejects.toMatchObject({ code: 'no_recipients' });
  });

  it('arranca una sola vez cuando vence, aunque dos corridas lleguen juntas', async () => {
    const { owner, c } = await draft('sc2');
    const now = new Date('2026-11-01T12:00:00Z');
    await scheduleCampaign(owner.id, c.id, '2026-11-01T13:00:00Z', now);
    // Antes de la hora no pasa nada.
    await startDueCampaigns(new Date('2026-11-01T12:30:00Z'));
    expect((await getCampaign(owner.id, c.id))?.status).toBe('draft');
    const later = new Date('2026-11-01T13:01:00Z');
    const [a, b] = await Promise.all([startDueCampaigns(later, 200), startDueCampaigns(later, 200)]);
    expect(a + b).toBeGreaterThanOrEqual(1);
    const after = await getCampaign(owner.id, c.id);
    expect(after?.status).not.toBe('draft');
    expect(after?.scheduled_at).toBeNull();
    expect(after?.total).toBe(1);
  });

  it('si al vencer ya no hay a quién mandar, queda en borrador con el motivo', async () => {
    const { owner, v, c } = await draft('sc3');
    const now = new Date('2026-11-01T12:00:00Z');
    await scheduleCampaign(owner.id, c.id, '2026-11-01T13:00:00Z', now);
    await setCampaignOptIn(v.id, false);
    await startDueCampaigns(new Date('2026-11-01T13:01:00Z'), 200);
    const after = await getCampaign(owner.id, c.id);
    expect(after?.status).toBe('draft');
    expect(after?.scheduled_at).toBeNull();
    expect(after?.schedule_error).toBe('no_recipients');
  });

  it('se puede cancelar', async () => {
    const { owner, c } = await draft('sc4');
    await scheduleCampaign(owner.id, c.id, '2026-11-02T13:00:00Z', new Date('2026-11-01T12:00:00Z'));
    await unscheduleCampaign(owner.id, c.id);
    expect((await getCampaign(owner.id, c.id))?.scheduled_at).toBeNull();
  });
});

describe('script del messenger', () => {
  it('lleva la fuente, el modo de adjuntos y el tiempo de respuesta, y no explota al identificar antes de armar el botón', async () => {
    const owner = await makeUser('js');
    const w = await createChatWidget(owner.id, null, { name: 'script' });
    await updateChatWidget(w.id, { font: 'serif', visitorAttachments: 'identified', replyTime: 'hour' });
    const res = await widgetScript.GET(new Request(`http://x/api/chat/widget.js?id=${w.id}`));
    const js = await res.text();
    expect(js).toContain('Iowan Old Style');
    expect(js).toContain('var ATTACH_MODE = "identified"');
    expect(js).toContain('var REPLY_TIME = "hour"');
    expect(js).toContain('if (!attachBtn) return;');
    // Sintaxis válida (el template no rompió nada).
    expect(() => new Function(js)).not.toThrow();
  });
});
