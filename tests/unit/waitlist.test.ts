import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb, type UserRow } from '@/lib/db';
import { joinedApps, joinWaitlist, notifyLiveApps, waitlistCounts, waitlistCsv, waitlistRows, WaitlistError } from '@/lib/waitlist';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({ getCurrentUser: async () => session.user }));
const sent = vi.hoisted(() => ({ list: [] as Array<{ to: string; subject: string }> }));
vi.mock('@/lib/email', async (orig) => ({
  ...(await orig<typeof import('@/lib/email')>()),
  sendEmail: async (o: { to: string; subject: string }) => {
    sent.list.push({ to: o.to, subject: o.subject });
    return { ok: true, provider: 'test' };
  },
}));

const route = await import('@/app/api/waitlist/route');

let ip = 0;
const post = (body: unknown) =>
  route.POST(new Request('http://localhost/api/waitlist', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.9.0.${++ip % 250}` }, body: JSON.stringify(body) }));

beforeEach(() => {
  session.user = null;
  sent.list = [];
});

describe('lista de espera', () => {
  it('suma una vez por app y email; repetir guarda el "para qué" y no duplica', async () => {
    const a = await joinWaitlist({ app: 'chat', email: ' Ana@Example.com ', source: 'site', locale: 'es' });
    expect(a).toMatchObject({ created: true, email: 'ana@example.com', app: 'chat' });
    const b = await joinWaitlist({ app: 'chat', email: 'ana@example.com', useCase: 'Soporte de la web', source: 'site' });
    expect(b.created).toBe(false);
    const rows = (await waitlistRows('chat')).filter((r) => r.email === 'ana@example.com');
    expect(rows).toHaveLength(1);
    expect(rows[0].use_case).toBe('Soporte de la web');
    expect(await joinedApps('ana@example.com')).toContain('chat');
  });

  it('solo apps Próximamente y emails válidos', async () => {
    await expect(joinWaitlist({ app: 'crm', email: 'x@example.com', source: 'site' })).rejects.toBeInstanceOf(WaitlistError);
    await expect(joinWaitlist({ app: 'nope', email: 'x@example.com', source: 'site' })).rejects.toBeInstanceOf(WaitlistError);
    await expect(joinWaitlist({ app: 'shop', email: 'no-es-email', source: 'site' })).rejects.toBeInstanceOf(WaitlistError);
  });

  it('POST con sesión: un clic con el email de la sesión y un solo email de confirmación', async () => {
    const u = await makeUser('wl1');
    const row = (await getDb().prepare('SELECT * FROM users WHERE id = ?').get(u.id)) as UserRow;
    session.user = { ...row, role: 'owner' };
    const res = await post({ app: 'agents', email: 'otro@example.com', useCase: 'Atender WhatsApp', locale: 'pt' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, created: true, app: 'agents', email: u.email });
    expect(sent.list).toEqual([{ to: u.email, subject: 'Você está na lista de espera do Agents' }]);
    const again = await post({ app: 'agents' });
    expect(await again.json()).toMatchObject({ created: false });
    expect(sent.list).toHaveLength(1);
  });

  it('POST sin sesión pide email; el honeypot responde ok sin guardar', async () => {
    expect((await post({ app: 'books' })).status).toBe(400);
    expect((await post({ app: 'books', email: 'bot@example.com', website: 'http://spam' })).status).toBe(200);
    expect((await waitlistRows('books')).some((r) => r.email === 'bot@example.com')).toBe(false);
    const ok = await post({ app: 'books', email: 'caro@example.com', locale: 'es' });
    expect(await ok.json()).toEqual({ ok: true, created: true, app: 'books' });
    expect(sent.list[0]).toEqual({ to: 'caro@example.com', subject: 'Estás en la lista de espera de Books' });
  });

  it('conteos por app y CSV a prueba de fórmulas', async () => {
    await joinWaitlist({ app: 'design', email: 'd1@example.com', useCase: '=HYPERLINK("x")', source: 'site' });
    const c = (await waitlistCounts()).find((r) => r.app === 'design');
    expect(c).toMatchObject({ total: expect.any(Number), withUseCase: expect.any(Number) });
    expect(c!.total).toBeGreaterThanOrEqual(1);
    const csv = waitlistCsv(await waitlistRows('design'));
    expect(csv.split('\n')[0]).toBe('app,email,use_case,locale,source,created_at,notified_at');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it('aviso de salida: solo apps que dejaron Próximamente, una vez por persona', async () => {
    // Una fila de una app que ya salió (como si CRM hubiera estado en la lista).
    await getDb().prepare("INSERT INTO app_waitlist (id, app, email, locale) VALUES ('wl_live_1', 'crm', 'live@example.com', 'en')").run();
    await joinWaitlist({ app: 'social', email: 'waiting@example.com', source: 'site' });
    const first = await notifyLiveApps();
    expect(first.sent).toBeGreaterThanOrEqual(1);
    expect(sent.list.some((m) => m.to === 'live@example.com' && m.subject === 'CRM is ready to use')).toBe(true);
    expect(sent.list.some((m) => m.to === 'waiting@example.com')).toBe(false);
    sent.list = [];
    await notifyLiveApps();
    expect(sent.list.some((m) => m.to === 'live@example.com')).toBe(false);
  });
});
