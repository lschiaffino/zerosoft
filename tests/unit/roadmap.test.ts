import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import type { RoadmapItemRow } from '@/lib/db';
import { setAiModelOverride } from '@/lib/ai';
import { createFeedback } from '@/lib/feedback';
import {
  createChatConversation,
  createChatMessage,
  createChatWidget,
  getOrCreateChatVisitor,
} from '@/lib/chat-data';
import {
  ROADMAP_AI_FEATURE,
  getRoadmapItem,
  hashIp,
  ingestChatConversation,
  ingestFeedback,
  listPublicRoadmap,
  mergeRoadmapItems,
  updateRoadmapItem,
} from '@/lib/roadmap';
import { makeUser } from './helpers';
import { failingModel, mockModel } from './ai-mock';

// La sesión se controla desde el test (fuera de una request no hay cookies).
const session = vi.hoisted(() => ({ user: null as null | { id: string; email: string } }));
vi.mock('@/lib/session', () => ({ getCurrentUser: async () => session.user }));

const { PATCH: patchItem } = await import('@/app/api/roadmap/[id]/route');
const { POST: mergeRoute } = await import('@/app/api/roadmap/merge/route');
const { POST: voteRoute } = await import('@/app/api/roadmap/[id]/vote/route');
const { POST: feedbackRoute } = await import('@/app/api/feedback/route');

const ENV_KEYS = [
  'AI_GATEWAY_API_KEY',
  'VERCEL_OIDC_TOKEN',
  'VERCEL',
  'AI_ENABLED',
  'AI_FREE_TOKENS_PER_MONTH',
  'ADMIN_EMAILS',
  'SUPPORT_WIDGET_ID',
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.AI_FREE_TOKENS_PER_MONTH = 'unlimited';
  session.user = null;
});

afterEach(() => {
  setAiModelOverride(null);
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function aiReturns(obj: Record<string, unknown>) {
  setAiModelOverride(mockModel(JSON.stringify(obj)));
}

async function feedback(message: string, kind: 'idea' | 'bug' | 'other' = 'idea', product: 'crm' | 'cal' | 'other' = 'crm') {
  return createFeedback({ kind, product, message });
}

async function makeItem(overrides: Partial<RoadmapItemRow> = {}): Promise<RoadmapItemRow> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await getDb()
    .prepare(
      `INSERT INTO roadmap_items (id, title, description, product, kind, status, votes, is_public, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      overrides.title ?? `Item ${id.slice(0, 6)}`,
      overrides.description ?? '',
      overrides.product ?? 'crm',
      overrides.kind ?? 'idea',
      overrides.status ?? 'planned',
      overrides.votes ?? 0,
      overrides.is_public ?? 1,
      now,
      now,
    );
  return (await getRoadmapItem(id))!;
}

async function signalCount(itemId: string): Promise<number> {
  const row = (await getDb().prepare('SELECT COUNT(*) AS n FROM roadmap_signals WHERE item_id = ?').get(itemId)) as { n: number };
  return Number(row.n);
}

function jsonReq(url: string, method: string, body?: unknown, ip?: string) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json', ...(ip ? { 'x-forwarded-for': ip } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('roadmap: clasificación con AI', () => {
  it('crea un ítem propuesto y privado cuando no hay duplicado', async () => {
    aiReturns({ kind: 'idea', product: 'crm', title: 'Export contacts to CSV', summary: 'Wants a CSV export.', duplicateOf: null });
    const fb = await feedback('me encantaría poder exportar contactos a csv, gracias!');
    const res = await ingestFeedback(fb);
    expect(res.action).toBe('created');
    expect(res.classification?.via).toBe('ai');
    const item = await getRoadmapItem(res.itemId!);
    expect(item).toMatchObject({
      title: 'Export contacts to CSV',
      product: 'crm',
      kind: 'idea',
      status: 'proposed',
      is_public: 0,
      votes: 1,
    });
    expect(await signalCount(item!.id)).toBe(1);
  });

  it('suma una señal y un voto al ítem existente que el modelo marca como duplicado', async () => {
    const existing = await makeItem({ title: 'Dark mode', status: 'planned', votes: 3 });
    aiReturns({ kind: 'idea', product: 'other', title: 'Add dark mode', summary: 'Dark theme.', duplicateOf: existing.id });
    const fb = await feedback('please add a dark theme');
    const res = await ingestFeedback(fb);
    expect(res).toMatchObject({ action: 'attached', itemId: existing.id });
    expect((await getRoadmapItem(existing.id))!.votes).toBe(4);
    expect(await signalCount(existing.id)).toBe(1);
    // Idempotente por feedback: no cuenta dos veces.
    expect((await ingestFeedback(fb)).action).toBe('duplicate_source');
    expect((await getRoadmapItem(existing.id))!.votes).toBe(4);
  });

  it('ignora ids de duplicado inventados por el modelo', async () => {
    aiReturns({ kind: 'bug', product: 'cal', title: 'Booking fails on Safari', summary: 'x', duplicateOf: 'no-such-id' });
    const res = await ingestFeedback(await feedback('no anda en safari', 'bug', 'cal'));
    expect(res.action).toBe('created');
    expect((await getRoadmapItem(res.itemId!))!.kind).toBe('bug');
  });

  it('preguntas y elogios no generan ítems', async () => {
    aiReturns({ kind: 'question', product: 'crm', title: 'How to import', summary: 'q', duplicateOf: null });
    expect((await ingestFeedback(await feedback('how do I import contacts?'))).action).toBe('ignored');
    aiReturns({ kind: 'praise', product: 'other', title: 'Love it', summary: 'p', duplicateOf: null });
    expect((await ingestFeedback(await feedback('love the product!', 'other', 'other'))).action).toBe('ignored');
  });

  it('mide el consumo en el workspace del primer admin; sin admins es llamada de sistema', async () => {
    const admin = await makeUser('rm-admin');
    process.env.ADMIN_EMAILS = `missing@test.local, ${admin.email}`;
    aiReturns({ kind: 'idea', product: 'crm', title: 'Metered idea', summary: 's', duplicateOf: null });
    await ingestFeedback(await feedback('metered idea'));
    const usage = (await getDb()
      .prepare('SELECT feature, input_tokens FROM ai_usage WHERE user_id = ?')
      .all(admin.id)) as Array<{ feature: string; input_tokens: number }>;
    expect(usage).toEqual([{ feature: ROADMAP_AI_FEATURE, input_tokens: 100 }]);

    delete process.env.ADMIN_EMAILS;
    const before = (await getDb().prepare('SELECT COUNT(*) AS n FROM ai_usage WHERE feature = ?').get(ROADMAP_AI_FEATURE)) as { n: number };
    const res = await ingestFeedback(await feedback('unmetered idea'));
    expect(res.classification?.via).toBe('ai');
    const after = (await getDb().prepare('SELECT COUNT(*) AS n FROM ai_usage WHERE feature = ?').get(ROADMAP_AI_FEATURE)) as { n: number };
    expect(Number(after.n)).toBe(Number(before.n));
  });
});

describe('roadmap: heurística sin AI', () => {
  it('usa el tipo del feedback y los primeros 80 caracteres como título', async () => {
    const msg = `Bug ${crypto.randomUUID()} — ${'the calendar sync drops events '.repeat(5)}`;
    const res = await ingestFeedback(await feedback(msg, 'bug', 'cal'));
    expect(res.action).toBe('created');
    expect(res.classification?.via).toBe('heuristic');
    const item = (await getRoadmapItem(res.itemId!))!;
    expect(item.kind).toBe('bug');
    expect(item.product).toBe('cal');
    expect(item.title.length).toBeLessThanOrEqual(80);
    expect(msg.startsWith(item.title.replace(/…$/, ''))).toBe(true);
    expect(item.is_public).toBe(0);
  });

  it('mismo título → se suma al ítem abierto; "other" sin palabras clave se ignora', async () => {
    const msg = `Idea ${crypto.randomUUID().slice(0, 8)}: bulk edit deals`;
    const first = await ingestFeedback(await feedback(msg));
    const second = await ingestFeedback(await feedback(msg));
    expect(second).toMatchObject({ action: 'attached', itemId: first.itemId });
    expect((await getRoadmapItem(first.itemId!))!.votes).toBe(2);
    expect((await ingestFeedback(await feedback('hola, buen día', 'other', 'other'))).action).toBe('ignored');
  });

  it('si el modelo falla cae a la heurística', async () => {
    setAiModelOverride(failingModel());
    const res = await ingestFeedback(await feedback(`falla ${crypto.randomUUID()}`, 'bug'));
    expect(res.action).toBe('created');
    expect(res.classification?.via).toBe('heuristic');
  });

  it('POST /api/feedback ingesta el feedback (en línea fuera de una request)', async () => {
    const message = `Feature ${crypto.randomUUID()}: recurring tasks`;
    const res = await feedbackRoute(jsonReq('http://x/api/feedback', 'POST', { kind: 'idea', product: 'crm', message }, '10.77.0.1'));
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const signal = await getDb().prepare("SELECT item_id FROM roadmap_signals WHERE source = 'feedback' AND source_id = ?").get(id);
    expect(signal).toBeTruthy();
  });
});

describe('roadmap: conversaciones de soporte', () => {
  async function supportConversation(lines: string[]) {
    const owner = await makeUser('support');
    const widget = await createChatWidget(owner.id, null, { name: 'Support', botEnabled: true, botSource: 'ai' });
    const visitor = await getOrCreateChatVisitor(widget.id, `ext-${crypto.randomUUID()}`);
    const conversation = await createChatConversation(widget.id, visitor.id);
    for (const l of lines) await createChatMessage(conversation.id, 'visitor', { body: l });
    return { widget, conversation };
  }

  it('clasifica solo conversaciones del widget de soporte', async () => {
    const { widget, conversation } = await supportConversation(['the CRM import is broken, it crashes']);
    expect((await ingestChatConversation(conversation.id)).action).toBe('ignored'); // sin SUPPORT_WIDGET_ID
    process.env.SUPPORT_WIDGET_ID = widget.id;
    const res = await ingestChatConversation(conversation.id);
    expect(res.action).toBe('created');
    expect(res.classification?.kind).toBe('bug');
    expect((await ingestChatConversation(conversation.id)).action).toBe('duplicate_source');

    const other = await supportConversation(['the CRM import is broken too']);
    expect((await ingestChatConversation(other.conversation.id)).action).toBe('ignored');
  });

  it('con AI usa la transcripción y el resumen como fragmento', async () => {
    const { widget, conversation } = await supportConversation(['hi', 'can you add a Zapier integration?']);
    process.env.SUPPORT_WIDGET_ID = widget.id;
    aiReturns({ kind: 'idea', product: 'other', title: 'Zapier integration', summary: 'Customer wants Zapier.', duplicateOf: null });
    const res = await ingestChatConversation(conversation.id);
    expect(res.action).toBe('created');
    const signal = (await getDb()
      .prepare("SELECT excerpt FROM roadmap_signals WHERE source = 'chat' AND source_id = ?")
      .get(conversation.id)) as { excerpt: string };
    expect(signal.excerpt).toBe('Customer wants Zapier.');
  });
});

describe('roadmap: público y votos', () => {
  it('el listado público solo muestra ítems públicos en planned / in_progress / done', async () => {
    const pub = await makeItem({ status: 'planned', is_public: 1 });
    const priv = await makeItem({ status: 'planned', is_public: 0 });
    const proposed = await makeItem({ status: 'proposed', is_public: 1 });
    const declined = await makeItem({ status: 'declined', is_public: 1 });
    const done = await makeItem({ status: 'done', is_public: 1 });
    const cols = await listPublicRoadmap();
    const ids = [...cols.planned, ...cols.in_progress, ...cols.done].map((i) => i.id);
    expect(ids).toContain(pub.id);
    expect(cols.done.map((i) => i.id)).toContain(done.id);
    for (const hidden of [priv.id, proposed.id, declined.id]) expect(ids).not.toContain(hidden);
  });

  it('un voto por IP por ítem, guardando solo el hash de la IP', async () => {
    const item = await makeItem({ status: 'in_progress', is_public: 1, votes: 2 });
    const vote = (ip: string) =>
      voteRoute(jsonReq(`http://x/api/roadmap/${item.id}/vote`, 'POST', undefined, ip), {
        params: Promise.resolve({ id: item.id }),
      });
    const ipA = `10.55.${Math.floor(Math.random() * 250)}.1`;
    const r1 = await vote(ipA);
    expect(r1.status).toBe(200);
    expect(await r1.json()).toEqual({ votes: 3, counted: true });
    expect(await (await vote(ipA)).json()).toEqual({ votes: 3, counted: false });
    expect(await (await vote(`${ipA}0`)).json()).toEqual({ votes: 4, counted: true });
    const rows = (await getDb().prepare('SELECT ip_hash FROM roadmap_votes WHERE item_id = ?').all(item.id)) as Array<{ ip_hash: string }>;
    expect(rows.map((r) => r.ip_hash).sort()).toEqual([hashIp(ipA), hashIp(`${ipA}0`)].sort());
    expect(rows.some((r) => r.ip_hash.includes(ipA))).toBe(false);
  });

  it('no se puede votar ítems privados, hechos o inexistentes', async () => {
    for (const item of [await makeItem({ is_public: 0 }), await makeItem({ status: 'done', is_public: 1 })]) {
      const res = await voteRoute(jsonReq(`http://x/api/roadmap/${item.id}/vote`, 'POST', undefined, '10.56.0.1'), {
        params: Promise.resolve({ id: item.id }),
      });
      expect(res.status).toBe(404);
    }
    const res = await voteRoute(jsonReq('http://x/api/roadmap/nope/vote', 'POST', undefined, '10.56.0.2'), {
      params: Promise.resolve({ id: 'nope' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('roadmap: admin', () => {
  it('las rutas de edición y fusión son 404 para quien no es admin', async () => {
    const admin = await makeUser('rm-boss');
    const other = await makeUser('rm-other');
    process.env.ADMIN_EMAILS = admin.email;
    const item = await makeItem({ is_public: 0, status: 'proposed' });
    const target = await makeItem();

    for (const user of [null, { id: other.id, email: other.email }]) {
      session.user = user;
      const p = await patchItem(jsonReq(`http://x/api/roadmap/${item.id}`, 'PATCH', { isPublic: true }), {
        params: Promise.resolve({ id: item.id }),
      });
      expect(p.status).toBe(404);
      const m = await mergeRoute(jsonReq('http://x/api/roadmap/merge', 'POST', { sourceId: item.id, targetId: target.id }));
      expect(m.status).toBe(404);
    }
    expect((await getRoadmapItem(item.id))!.is_public).toBe(0);

    session.user = { id: admin.id, email: admin.email };
    const ok = await patchItem(
      jsonReq(`http://x/api/roadmap/${item.id}`, 'PATCH', { isPublic: true, status: 'planned', title: 'Approved title' }),
      { params: Promise.resolve({ id: item.id }) },
    );
    expect(ok.status).toBe(200);
    expect(await getRoadmapItem(item.id)).toMatchObject({ is_public: 1, status: 'planned', title: 'Approved title' });
    const bad = await patchItem(jsonReq(`http://x/api/roadmap/${item.id}`, 'PATCH', { status: 'shipped' }), {
      params: Promise.resolve({ id: item.id }),
    });
    expect(bad.status).toBe(400);
    const merged = await mergeRoute(jsonReq('http://x/api/roadmap/merge', 'POST', { sourceId: item.id, targetId: target.id }));
    expect(merged.status).toBe(200);
    expect(await getRoadmapItem(item.id)).toBeUndefined();
  });

  it('fusionar mueve señales y votos sin duplicar IPs', async () => {
    const a = await makeItem({ status: 'planned', is_public: 1 });
    const b = await makeItem({ status: 'planned', is_public: 1 });
    const db = getDb();
    const now = new Date().toISOString();
    for (const [item, src] of [[a, 'fa'], [b, 'fb']] as const) {
      await db
        .prepare("INSERT INTO roadmap_signals (id, item_id, source, source_id, excerpt, created_at) VALUES (?, ?, 'feedback', ?, 'x', ?)")
        .run(crypto.randomUUID(), item.id, `${src}-${crypto.randomUUID()}`, now);
    }
    for (const [item, ip] of [[a, 'h1'], [a, 'h2'], [b, 'h2']] as const) {
      await db.prepare('INSERT INTO roadmap_votes (item_id, ip_hash, created_at) VALUES (?, ?, ?)').run(item.id, ip, now);
    }
    await updateRoadmapItem(a.id, { description: 'source' });
    const target = await mergeRoadmapItems(a.id, b.id);
    // 2 señales + 2 IPs distintas (h1, h2).
    expect(target!.votes).toBe(4);
    expect(await signalCount(b.id)).toBe(2);
    expect(await getRoadmapItem(a.id)).toBeUndefined();
    expect(await mergeRoadmapItems(b.id, b.id)).toBeUndefined();
  });
});
