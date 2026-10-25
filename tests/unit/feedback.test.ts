import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import {
  createFeedback,
  isAdminEmail,
  listFeedback,
  parseFeedback,
  productFromPath,
  setFeedbackStatus,
  FEEDBACK_MAX,
} from '@/lib/feedback';
import { makeUser } from './helpers';

// La sesión se controla desde el test (fuera de una request no hay cookies).
const session = vi.hoisted(() => ({ user: null as null | { id: string; email: string } }));
vi.mock('@/lib/session', () => ({ getCurrentUser: async () => session.user }));

const { POST } = await import('@/app/api/feedback/route');

function post(body: unknown, ip = `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`) {
  return POST(
    new Request('http://x/api/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, 'user-agent': 'vitest' },
      body: JSON.stringify(body),
    }),
  );
}

async function countByMessage(message: string): Promise<number> {
  const row = (await getDb().prepare('SELECT COUNT(*) AS n FROM feedback WHERE message = ?').get(message)) as { n: number };
  return Number(row.n);
}

describe('feedback: validación', () => {
  it('acepta un feedback válido y completa product por defecto', () => {
    const r = parseFeedback({ kind: 'bug', message: 'Se rompe al guardar' });
    expect(r).toMatchObject({ ok: true, data: { kind: 'bug', product: 'other', message: 'Se rompe al guardar' } });
  });

  it('rechaza kind/product inválidos, mensaje vacío o demasiado largo', () => {
    expect(parseFeedback({ kind: 'rant', message: 'hola hola' }).ok).toBe(false);
    expect(parseFeedback({ kind: 'idea', product: 'erp', message: 'hola hola' }).ok).toBe(false);
    expect(parseFeedback({ kind: 'idea', message: '   ' }).ok).toBe(false);
    expect(parseFeedback({ kind: 'idea', message: 'x'.repeat(FEEDBACK_MAX + 1) }).ok).toBe(false);
    expect(parseFeedback({ kind: 'idea', message: 'x'.repeat(FEEDBACK_MAX) }).ok).toBe(true);
  });

  it('email opcional: vacío se ignora, inválido se rechaza', () => {
    expect(parseFeedback({ kind: 'idea', message: 'una idea', email: '' })).toMatchObject({ ok: true });
    expect(parseFeedback({ kind: 'idea', message: 'una idea', email: 'no-es-email' }).ok).toBe(false);
  });

  it('honeypot completo = spam', () => {
    expect(parseFeedback({ kind: 'idea', message: 'compre ya', website: 'http://spam' })).toEqual({ ok: false, error: 'spam' });
  });

  it('producto según la ruta de la app', () => {
    expect(productFromPath('/app')).toBe('platform');
    expect(productFromPath('/es/app/settings/api')).toBe('platform');
    expect(productFromPath('/app/links/new')).toBe('link');
    expect(productFromPath('/app/crm/deals')).toBe('crm');
    expect(productFromPath('/en/app/calendar/bookings')).toBe('cal');
    expect(productFromPath('/app/track')).toBe('track');
    expect(productFromPath('/app/chat/inbox')).toBe('chat');
    expect(productFromPath('/app/docs/abc')).toBe('docs');
    expect(productFromPath('/changelog')).toBe('site');
  });
});

describe('feedback: almacenamiento', () => {
  it('guarda, lista y cambia el estado', async () => {
    const row = await createFeedback({ kind: 'idea', product: 'cal', message: `idea ${crypto.randomUUID()}`, pageUrl: 'javascript:alert(1)' });
    expect(row.status).toBe('new');
    expect(row.page_url).toBeNull(); // solo http(s)
    expect(await setFeedbackStatus(row.id, 'done')).toBe(true);
    const done = await listFeedback({ status: 'done' });
    expect(done.some((r) => r.id === row.id)).toBe(true);
    expect((await listFeedback({ status: 'new' })).some((r) => r.id === row.id)).toBe(false);
    expect(await setFeedbackStatus('no-existe', 'read')).toBe(false);
  });

  it('allowlist de ADMIN_EMAILS (vacía = nadie)', () => {
    vi.stubEnv('ADMIN_EMAILS', '');
    expect(isAdminEmail('a@b.com')).toBe(false);
    vi.stubEnv('ADMIN_EMAILS', ' A@b.com , c@d.com');
    expect(isAdminEmail('a@B.com')).toBe(true);
    expect(isAdminEmail('x@y.com')).toBe(false);
    vi.unstubAllEnvs();
  });
});

describe('POST /api/feedback', () => {
  beforeEach(() => {
    session.user = null;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('visitante: guarda con email opcional y user agent', async () => {
    const message = `bug ${crypto.randomUUID()}`;
    const res = await post({ kind: 'bug', product: 'site', message, email: 'v@ejemplo.com', pageUrl: 'https://zerosoft.ai/en' });
    expect(res.status).toBe(201);
    const [row] = (await getDb().prepare('SELECT * FROM feedback WHERE message = ?').all(message)) as Array<Record<string, unknown>>;
    expect(row).toMatchObject({ kind: 'bug', product: 'site', email: 'v@ejemplo.com', user_id: null, user_agent: 'vitest', page_url: 'https://zerosoft.ai/en' });
  });

  it('logueado: asocia user_id y email de la sesión', async () => {
    const u = await makeUser('fb');
    session.user = { id: u.id, email: u.email };
    const message = `idea ${crypto.randomUUID()}`;
    const res = await post({ kind: 'idea', product: 'crm', message, email: 'otro@x.com' });
    expect(res.status).toBe(201);
    const row = (await getDb().prepare('SELECT user_id, email FROM feedback WHERE message = ?').get(message)) as Record<string, unknown>;
    expect(row).toEqual({ user_id: u.id, email: u.email });
  });

  it('honeypot: responde ok pero no guarda', async () => {
    const message = `spam ${crypto.randomUUID()}`;
    const res = await post({ kind: 'other', message, website: 'http://spam.example' });
    expect(res.status).toBe(200);
    expect(await countByMessage(message)).toBe(0);
  });

  it('input inválido: 400', async () => {
    expect((await post({ kind: 'idea', message: '' })).status).toBe(400);
    expect((await post({ kind: 'idea', message: 'x'.repeat(FEEDBACK_MAX + 1) })).status).toBe(400);
  });

  it('rate limit: 5 por IP cada 10 minutos', async () => {
    const ip = `10.250.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await post({ kind: 'idea', message: `rl ${i} ${ip}` }, ip)).status);
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
  });

  it('si el email de aviso falla, el feedback igual se guarda', async () => {
    vi.stubEnv('FEEDBACK_EMAIL', 'owner@zerosoft.ai');
    vi.stubEnv('RESEND_API_KEY', 'k');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ message: 'boom' }), { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    const message = `aviso ${crypto.randomUUID()}`;
    const res = await post({ kind: 'bug', product: 'link', message });
    vi.unstubAllGlobals();
    expect(res.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(await countByMessage(message)).toBe(1);
  });
});
