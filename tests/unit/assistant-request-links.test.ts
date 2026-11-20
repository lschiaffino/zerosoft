import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb, upsertUser, type UserRow } from '@/lib/db';
import type { SessionUser } from '@/lib/session';

/**
 * Link por pedido y aviso cuando sale: la persona que le pide algo al
 * asistente recibe un link (público si el ítem está publicado, si no la
 * página privada del pedido), lo encuentra después con my_feature_requests y
 * en Ajustes › Mis pedidos, y le llega un email cuando sale. Nadie ve las
 * palabras ni la identidad de otra persona que pidió lo mismo. Todas las
 * direcciones son de dominios de ejemplo.
 */

const sent = vi.hoisted(() => ({ list: [] as Array<{ to: string; subject: string; text?: string; html?: string }> }));
vi.mock('@/lib/email', async (orig) => ({
  ...(await orig<typeof import('@/lib/email')>()),
  sendEmail: async (o: { to: string; subject: string; text?: string; html?: string }) => {
    sent.list.push(o);
    return { ok: true, provider: 'test' };
  },
}));

const { getRoadmapItem, updateRoadmapItem } = await import('@/lib/roadmap');
const { setSubscription, isSubscribed } = await import('@/lib/board');
const { getRequestView, listMyRequests, requestLink, requestStage, requestViewForSession } = await import('@/lib/my-requests');
const { toolCtx } = await import('@/lib/assistant/registry');
const { requestTools } = await import('@/lib/assistant/tools-requests');
const { FEATURE_REQUEST_GUIDANCE } = await import('@/lib/assistant/engine');

const tag = () => crypto.randomUUID().replace(/-/g, '').slice(0, 8);

async function person(label: string, domain = 'example.com'): Promise<UserRow> {
  const id = `${label}-${tag()}`;
  return upsertUser({ id, email: `${id}@${domain}`, name: `Name ${label} ${tag()}`, image: null });
}

const owner = (u: UserRow) => ({ ...u, role: 'owner', apps: '*' }) as unknown as SessionUser;
const tool = (name: string) => {
  const t = requestTools.find((x) => x.name === name)!;
  if (t.kind !== 'read') throw new Error(`${name} should run in the turn`);
  return t;
};

async function ask(u: UserRow, input: { title: string; details?: string; app?: string }, locale = 'en') {
  return (await tool('request_feature').run(toolCtx(owner(u), locale), { details: '', ...input })) as Record<string, unknown>;
}

async function itemOf(u: UserRow, titleStart: string): Promise<string> {
  const row = (await getDb()
    .prepare(
      `SELECT s.item_id FROM roadmap_signals s JOIN feedback f ON f.id = s.source_id
       WHERE s.source = 'feedback' AND f.user_id = ? AND f.message LIKE ? ORDER BY f.created_at DESC LIMIT 1`,
    )
    .get(u.id, `${titleStart}%`)) as { item_id: string };
  return row.item_id;
}

/** Lo que decide la página /app/settings/requests/<id> para esa sesión: 'ok' o el 404. */
async function renderPage(user: UserRow | SessionUser, id: string): Promise<'ok' | 'not_found'> {
  const s = 'role' in user ? (user as SessionUser) : owner(user);
  return (await requestViewForSession(s, id, 'en')) ? 'ok' : 'not_found';
}

beforeEach(() => {
  vi.stubEnv('AI_ENABLED', 'false');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  vi.stubEnv('FEATURE_PRIORITY_EMAILS', '');
  vi.stubEnv('BACKLOG_GITHUB_REPO', '');
  vi.stubEnv('BACKLOG_GITHUB_TOKEN', '');
  vi.stubEnv('ADMIN_EMAILS', '');
  vi.stubEnv('RESEND_API_KEY', 're_test_key');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://zerosoft.example');
  vi.stubEnv('FEEDBACK_HOST', '');
  sent.list = [];
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('link del pedido', () => {
  it('privado: la página de la app con locale; publicado: la página pública del board', () => {
    const base = { id: 'rm-1', title: 'Export CSV', status: 'proposed', is_public: 0 } as const;
    expect(requestLink(base, 'es')).toEqual({ url: '/es/app/settings/requests/rm-1', published: false });
    // planned pero sin publicar sigue siendo privado.
    expect(requestLink({ ...base, status: 'planned' }, 'en').published).toBe(false);
    const pub = requestLink({ ...base, status: 'planned', is_public: 1 }, 'en');
    expect(pub.published).toBe(true);
    expect(pub.url).toMatch(/^https:\/\/.+\/i\/rm-1-export-csv$/);
    // proposed nunca es público, aunque is_public diga 1.
    expect(requestLink({ ...base, is_public: 1 }, 'en').published).toBe(false);
  });

  it('estados en lenguaje común', () => {
    expect(['proposed', 'idea', 'considering', 'planned', 'in_progress', 'done', 'declined'].map(requestStage)).toEqual([
      'received',
      'considering',
      'considering',
      'planned',
      'in_progress',
      'shipped',
      'declined',
    ]);
  });

  it('request_feature devuelve el link y suscribe a quien pide aunque el ítem sea privado', async () => {
    const u = await person('rl-sub');
    const title = `Snooze Zq${tag()} reminders from Track`;
    const out = await ask(u, { title, details: 'quiero posponer recordatorios', app: 'track' }, 'es');
    const id = await itemOf(u, title);
    expect(out.url).toBe(`/es/app/settings/requests/${id}`);
    expect(String(out.note)).toMatch(/url/);
    expect(await isSubscribed(id, u.id)).toBe(true);
    const sub = (await getDb().prepare('SELECT reason, locale FROM roadmap_subscriptions WHERE item_id = ? AND user_id = ?').get(id, u.id)) as {
      reason: string;
      locale: string;
    };
    expect(sub).toEqual({ reason: 'author', locale: 'es' });
  });

  it('si se desuscribió, pedirlo otra vez no lo vuelve a suscribir', async () => {
    const u = await person('rl-unsub');
    const title = `Merge Zq${tag()} duplicate contacts in CRM`;
    await ask(u, { title, app: 'crm' });
    const id = await itemOf(u, title);
    await setSubscription(id, u.id, false);
    await ask(u, { title, app: 'crm' });
    expect(await isSubscribed(id, u.id)).toBe(false);
  });

  it('la guía le pide compartir el link y nunca decir que no hay página', () => {
    expect(FEATURE_REQUEST_GUIDANCE).toMatch(/url/);
    expect(FEATURE_REQUEST_GUIDANCE).toMatch(/my_feature_requests/);
    expect(FEATURE_REQUEST_GUIDANCE).toMatch(/Never say there is no page/);
  });
});

describe('página del pedido y Mis pedidos', () => {
  async function shared() {
    const a = await person('rl-a');
    const b = await person('rl-b', 'example.org');
    const word = `Zq${tag()}`;
    await ask(a, { title: `Two-way sync of ${word} fields in Inbox`, details: `secreto de A ${word}`, app: 'inbox' });
    await ask(b, { title: `Inbox: edit ${word} field with two way sync`, details: `palabras de B ${word}`, app: 'inbox' });
    const id = await itemOf(a, 'Two-way sync of');
    expect(await itemOf(b, 'Inbox: edit')).toBe(id);
    return { a, b, word, id };
  }

  it('quien pidió ve su página con sus palabras; nunca las de la otra persona', async () => {
    const { a, b, word, id } = await shared();
    const va = (await getRequestView(id, { id: a.id, email: a.email, isAdmin: false }, 'en'))!;
    expect(va.isRequester).toBe(true);
    expect(va.title).toBe(`Two-way sync of ${word} fields in Inbox`);
    expect(va.words.map((w) => w.text)).toEqual([`secreto de A ${word}`]);
    const vb = (await getRequestView(id, { id: b.id, email: b.email, isAdmin: false }, 'en'))!;
    // Privado: B ve su propio título, no el del ítem (que escribió A).
    expect(vb.title).toBe(`Inbox: edit ${word} field with two way sync`);
    const json = JSON.stringify(vb);
    expect(json).not.toContain('secreto de A');
    expect(json).not.toContain(a.email);
    expect(json).not.toContain(a.id);
    expect(json).not.toContain(String(a.name));
    expect(vb.adminPath).toBeNull();
    expect(await renderPage(a, id)).toBe('ok');
    expect(await renderPage(b, id)).toBe('ok');
  });

  it('otra persona del workspace, otro workspace y un id inexistente: el mismo 404', async () => {
    const { a, id } = await shared();
    const stranger = await person('rl-stranger', 'example.net');
    expect(await getRequestView(id, { id: stranger.id, email: stranger.email, isAdmin: false }, 'en')).toBeNull();
    expect(await renderPage(stranger, id)).toBe('not_found');
    expect(await renderPage(stranger, `missing-${tag()}`)).toBe('not_found');
    // Un compañero del workspace de A, que no lo pidió.
    const mate = await person('rl-mate');
    const asMate = { ...owner(a), actingUser: mate, role: 'member' } as unknown as SessionUser;
    expect(await renderPage(asMate, id)).toBe('not_found');
  });

  it('admin: ve la página sin palabras de nadie, con el link al admin del roadmap', async () => {
    const { a, id } = await shared();
    const admin = await person('rl-admin', 'example.com');
    vi.stubEnv('ADMIN_EMAILS', admin.email);
    const v = (await getRequestView(id, { id: admin.id, email: admin.email, isAdmin: true }, 'en'))!;
    expect(v.isRequester).toBe(false);
    expect(v.words).toEqual([]);
    expect(v.adminPath).toBe(`/app/settings/roadmap?item=${id}`);
    expect(JSON.stringify(v)).not.toContain(a.email);
    expect(await renderPage(admin, id)).toBe('ok');
  });

  it('las notas internas y el motivo de cierre de un ítem privado no se muestran', async () => {
    const { a, id } = await shared();
    await updateRoadmapItem(id, { status: 'declined', declinedReason: 'Internal: customer X churned' }, { note: 'internal note' });
    const v = (await getRequestView(id, { id: a.id, email: a.email, isAdmin: false }, 'en'))!;
    expect(v.stage).toBe('declined');
    expect(JSON.stringify(v)).not.toContain('Internal');
    expect(JSON.stringify(v)).not.toContain('internal note');
  });

  it('Mis pedidos y my_feature_requests: solo los de quien pregunta', async () => {
    const { a, b, word, id } = await shared();
    const mine = await listMyRequests({ id: b.id, email: b.email }, 'en');
    const row = mine.find((r) => r.id === id)!;
    expect(row).toMatchObject({ title: `Inbox: edit ${word} field with two way sync`, stage: 'received', path: `/app/settings/requests/${id}`, url: `/en/app/settings/requests/${id}` });
    const other = await person('rl-other');
    await ask(other, { title: `Dark Zq${tag()} theme for Forms`, app: 'forms' });
    const out = (await tool('my_feature_requests').run(toolCtx(owner(b), 'en'), {})) as { requests: Array<{ title: string; url: string }>; listUrl: string };
    expect(out.listUrl).toBe('/en/app/settings/requests');
    expect(out.requests.map((r) => r.url)).toContain(`/en/app/settings/requests/${id}`);
    const json = JSON.stringify(out);
    expect(json).not.toContain('Two-way sync of');
    expect(json).not.toContain('Dark Zq');
    expect(json).not.toContain(a.email);
    const none = (await tool('my_feature_requests').run(toolCtx(owner(await person('rl-none')), 'en'), {})) as { requests: unknown[] };
    expect(none.requests).toEqual([]);
  });
});

describe('aviso cuando sale', () => {
  it('privado que sale: un email por persona que lo pidió, con su link y sin la otra persona', async () => {
    const a = await person('rl-ship-a');
    const b = await person('rl-ship-b', 'example.org');
    const word = `Zq${tag()}`;
    await ask(a, { title: `Bulk tag ${word} contacts in CRM`, details: 'A words', app: 'crm' });
    await ask(b, { title: `CRM bulk tag ${word} contacts`, details: 'B words', app: 'crm' });
    const id = await itemOf(a, 'Bulk tag');
    expect(await itemOf(b, 'CRM bulk tag')).toBe(id);
    // B vuelve a pedirlo: sigue siendo un solo email para B.
    await ask(b, { title: `CRM bulk tag ${word} contacts`, app: 'crm' });

    // Estados internos de un ítem privado: ningún email.
    await updateRoadmapItem(id, { status: 'planned' });
    await updateRoadmapItem(id, { status: 'in_progress' });
    expect(sent.list).toEqual([]);

    await updateRoadmapItem(id, { status: 'done', shippedChangelogId: '2026-11-19-bulk-tag' });
    expect((await getRoadmapItem(id))!.is_public).toBe(0);
    expect(sent.list.map((m) => m.to).sort()).toEqual([a.email, b.email].sort());
    const toA = sent.list.find((m) => m.to === a.email)!;
    const toB = sent.list.find((m) => m.to === b.email)!;
    expect(toA.text).toContain(`https://zerosoft.example/en/app/settings/requests/${id}`);
    expect(toA.text).toContain('#2026-11-19-bulk-tag');
    expect(toA.subject).toContain(`Bulk tag ${word} contacts in CRM`);
    expect(toB.subject).toContain(`CRM bulk tag ${word} contacts`);
    for (const [mail, other] of [
      [toA, b],
      [toB, a],
    ] as const) {
      const body = `${mail.subject}\n${mail.text}\n${mail.html}`;
      expect(body).not.toContain(other.email);
      expect(body).not.toContain(String(other.name));
      expect(body).not.toContain(other.id);
    }
    expect(toB.text).not.toContain('Bulk tag');

    // Mismo estado otra vez: nada nuevo.
    sent.list = [];
    await updateRoadmapItem(id, { status: 'done' });
    expect(sent.list).toEqual([]);
  });

  it('quien se desuscribió no recibe el email', async () => {
    const a = await person('rl-off');
    const title = `Archive Zq${tag()} old Docs pages`;
    await ask(a, { title, app: 'docs' });
    const id = await itemOf(a, title);
    await setSubscription(id, a.id, false);
    await updateRoadmapItem(id, { status: 'done' });
    expect(sent.list).toEqual([]);
  });

  it('publicado y lanzado por el changelog: un email por persona con el link público', async () => {
    const a = await person('rl-pub-a');
    const title = `Print Zq${tag()} invoices from Books`;
    await ask(a, { title, app: 'books' });
    const id = await itemOf(a, title);
    await updateRoadmapItem(id, { status: 'done', isPublic: true, shippedChangelogId: '2026-11-19-print' });
    const toA = sent.list.filter((m) => m.to === a.email);
    expect(toA).toHaveLength(1);
    expect(toA[0].text).toMatch(/\/i\//);
  });

  it('declined no manda email', async () => {
    const a = await person('rl-decl');
    const title = `Fax Zq${tag()} contracts from Sign`;
    await ask(a, { title, app: 'sign' });
    const id = await itemOf(a, title);
    await updateRoadmapItem(id, { status: 'declined', declinedReason: 'No' });
    expect(sent.list).toEqual([]);
  });
});
