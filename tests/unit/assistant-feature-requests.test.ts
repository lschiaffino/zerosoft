import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb, upsertUser } from '@/lib/db';
import type { SessionUser } from '@/lib/session';
import { findSimilarItems, getPublicItem, listBoardItems, listMyPendingItems } from '@/lib/board';
import { getRoadmapItem, updateRoadmapItem } from '@/lib/roadmap';
import { listAssistantRequestItems, recordFeatureRequest, titleSimilarity } from '@/lib/feature-requests';
import { buildIssuePayload, issueInputFor, requesterRef, syncBacklogIssue, syncPendingBacklogIssues } from '@/lib/feature-requests-github';
import { toolCtx } from '@/lib/assistant/registry';
import { requestTools } from '@/lib/assistant/tools-requests';
import { toolsFor } from '@/lib/assistant/tools';
import { setAssistantModelOverride } from '@/lib/assistant/config';
import { FEATURE_REQUEST_GUIDANCE, runAssistantTurn, type AssistantEvent } from '@/lib/assistant/engine';
import { fakeAssistantStep } from '@/lib/assistant/fake';
import { fakeModel, type FakeCallInfo } from '@/lib/crm-ai-fake';
import { addMessage, createConversation, listMessages } from '@/lib/assistant/store';

/**
 * Pedidos de funciones desde el asistente: entran al backlog interno
 * (privado), se suman al mismo ítem si ya los pidió alguien, los de
 * FEATURE_PRIORITY_EMAILS van primero, y la copia a GitHub es opcional y sin
 * datos personales. Todas las direcciones son de dominios de ejemplo.
 */

const tag = () => crypto.randomUUID().replace(/-/g, '').slice(0, 8);

async function person(label: string, domain = 'example.com') {
  const id = `${label}-${tag()}`;
  return upsertUser({ id, email: `${id}@${domain}`, name: `Name ${label}`, image: null });
}

const owner = (u: { id: string }) => ({ ...u, role: 'owner', apps: '*' }) as unknown as SessionUser;
const requestFeature = requestTools.find((t) => t.name === 'request_feature')!;

async function ask(u: { id: string }, input: { title: string; details?: string; app?: string }) {
  if (requestFeature.kind !== 'read') throw new Error('request_feature should run in the turn');
  return (await requestFeature.run(toolCtx(owner(u), 'en'), { details: '', ...input })) as Record<string, unknown>;
}

async function itemFor(feedbackTitle: string) {
  return (await getDb()
    .prepare(
      `SELECT s.item_id FROM roadmap_signals s JOIN feedback f ON f.id = s.source_id
       WHERE s.source = 'feedback' AND f.message LIKE ? ORDER BY f.created_at DESC LIMIT 1`,
    )
    .get(`${feedbackTitle}%`)) as { item_id: string } | undefined;
}

async function signals(itemId: string) {
  return (await getDb().prepare('SELECT COUNT(*) AS n FROM roadmap_signals WHERE item_id = ?').get(itemId)) as { n: number };
}

beforeEach(() => {
  vi.stubEnv('AI_ENABLED', 'false');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  vi.stubEnv('FEATURE_PRIORITY_EMAILS', '');
  vi.stubEnv('BACKLOG_GITHUB_REPO', '');
  vi.stubEnv('BACKLOG_GITHUB_TOKEN', '');
});
afterEach(() => {
  setAssistantModelOverride(null);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('request_feature', () => {
  it('anota el pedido: feedback del asistente con persona y workspace, ítem privado en proposed', async () => {
    const u = await person('fr-rec');
    const title = `Pin Zq${tag()} chats to the top of Inbox`;
    const out = await ask(u, { title, details: 'quiero editar un campo desde inbox', app: 'inbox' });
    expect(out).toMatchObject({ recorded: true, addedToExisting: false, priority: false });
    expect(out).not.toHaveProperty('publicItem');

    const { item_id } = (await itemFor(title))!;
    const item = (await getRoadmapItem(item_id))!;
    expect(item).toMatchObject({ title, status: 'proposed', is_public: 0, kind: 'idea', product: 'inbox' });
    expect(Number(item.github_dirty)).toBeGreaterThan(0);
    const fb = (await getDb()
      .prepare("SELECT f.* FROM feedback f JOIN roadmap_signals s ON s.source_id = f.id WHERE s.item_id = ?")
      .get(item_id)) as { source: string; workspace_id: string; user_id: string; kind: string };
    expect(fb).toMatchObject({ source: 'assistant', workspace_id: u.id, user_id: u.id, kind: 'idea' });
  });

  it('el mismo pedido de otra persona suma una señal al ítem que ya existe, sin crear otro', async () => {
    const a = await person('fr-a');
    const b = await person('fr-b');
    const word = `Zq${tag()}`;
    await ask(a, { title: `Two-way sync of ${word} fields in Inbox`, app: 'inbox' });
    const first = (await itemFor(`Two-way sync of ${word}`))!.item_id;
    const out = await ask(b, { title: `Inbox: edit ${word} field with two way sync`, app: 'inbox' });
    expect(out).toMatchObject({ recorded: true, addedToExisting: true, askedBefore: false });
    const second = (await itemFor(`Inbox: edit ${word}`))!.item_id;
    expect(second).toBe(first);
    expect(Number((await signals(first)).n)).toBe(2);
    const created = (await getDb().prepare('SELECT COUNT(*) AS n FROM roadmap_items WHERE title LIKE ?').get(`%${word}%`)) as { n: number };
    expect(Number(created.n)).toBe(1);
    // Nada del pedido de la otra persona vuelve en el resultado.
    expect(JSON.stringify(out)).not.toContain('Two-way sync of');

    // La misma persona otra vez: otra señal, y sabe que ya lo había pedido.
    const again = await ask(b, { title: `Inbox: edit ${word} field with two way sync` });
    expect(again).toMatchObject({ addedToExisting: true, askedBefore: true });
    expect(Number((await signals(first)).n)).toBe(3);
  });

  it('pedidos distintos no se juntan', () => {
    expect(titleSimilarity('Export contacts to CSV', 'Export invoices to PDF')).toBeLessThan(0.6);
    expect(titleSimilarity('Two-way sync HubSpot fields in Inbox', 'Edit HubSpot field from Inbox with two way sync')).toBeGreaterThanOrEqual(0.6);
  });

  it('FEATURE_PRIORITY_EMAILS: prioridad máxima y aceptado (planned), sigue privado', async () => {
    const lead = await person('fr-lead', 'example.org');
    const other = await person('fr-regular', 'example.net');
    vi.stubEnv('FEATURE_PRIORITY_EMAILS', ` someone@example.com , ${lead.email.toUpperCase()} `);
    const word = `Zq${tag()}`;
    const normal = await ask(other, { title: `Bulk archive ${word} deals in CRM`, app: 'crm' });
    expect(normal.priority).toBe(false);
    const id = (await itemFor(`Bulk archive ${word}`))!.item_id;
    expect((await getRoadmapItem(id))).toMatchObject({ status: 'proposed', priority: 0 });

    const out = await ask(lead, { title: `Bulk archive ${word} deals in CRM`, app: 'crm' });
    expect(out.priority).toBe(true);
    expect(await getRoadmapItem(id)).toMatchObject({ status: 'planned', priority: 1, is_public: 0 });
    // Primero en la lista del admin.
    const listed = await listAssistantRequestItems();
    expect(listed.find((i) => i.id === id)).toMatchObject({ priority: 1, people: 2 });
    const firstRegular = listed.findIndex((i) => Number(i.priority) === 0);
    if (firstRegular !== -1) expect(listed.findIndex((i) => i.id === id)).toBeLessThan(firstRegular);
  });

  it('no es público y otro workspace no lo ve; el admin lo publica o lo descarta', async () => {
    const author = await person('fr-author');
    const stranger = await person('fr-stranger');
    const title = `Color labels Zq${tag()} for Notes`;
    await ask(author, { title, app: 'notes' });
    const id = (await itemFor(title))!.item_id;

    expect(await getPublicItem(id)).toBeUndefined();
    expect((await listBoardItems({ userId: stranger.id })).map((i) => i.id)).not.toContain(id);
    expect((await findSimilarItems(title, stranger.id)).map((i) => i.id)).not.toContain(id);
    expect((await listMyPendingItems({ id: stranger.id, email: stranger.email })).map((i) => i.id)).not.toContain(id);
    // Quien lo pidió lo ve en sus pedidos en revisión.
    expect((await listMyPendingItems({ id: author.id, email: author.email })).map((i) => i.id)).toContain(id);

    // Admin: está en la lista de pedidos del asistente; publicar lo lleva al board.
    expect((await listAssistantRequestItems()).map((i) => i.id)).toContain(id);
    await updateRoadmapItem(id, { status: 'idea', isPublic: true });
    expect((await listBoardItems({})).map((i) => i.id)).toContain(id);
    // Ya público: el resultado de otro pedido igual puede linkearlo.
    const out = await ask(stranger, { title, app: 'notes' });
    expect(out.publicItem).toMatchObject({ title, href: `/feedback-board/i/${id}` });

    // Descartar: cerrado y fuera de lo abierto; un pedido nuevo igual crea otro ítem privado.
    await updateRoadmapItem(id, { status: 'declined', isPublic: false, declinedReason: 'Out of scope' });
    expect((await getRoadmapItem(id))!.status).toBe('declined');
    await ask(author, { title });
    expect((await itemFor(title))!.item_id).not.toBe(id);
  });
});

describe('copia a GitHub', () => {
  it('sin BACKLOG_GITHUB_* no manda nada', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const u = await person('fr-nogh');
    const title = `Offline mode Zq${tag()} for Docs`;
    await ask(u, { title });
    const id = (await itemFor(title))!.item_id;
    expect(await syncBacklogIssue(id)).toBe('skipped');
    expect(await syncPendingBacklogIssues()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('arma el issue sin email ni nombre, con app, conteo, link al admin y etiquetas', async () => {
    const u = await person('fr-payload');
    const title = `Recurring Zq${tag()} invoices in Books`;
    await ask(u, { title, details: `Necesito facturas recurrentes. Escribime a ${u.email} o al +54 11 5555 1234`, app: 'books' });
    const id = (await itemFor(title))!.item_id;
    const input = (await issueInputFor(id))!;
    const p = buildIssuePayload(input);
    expect(p.title).toBe(title);
    expect(p.labels).toEqual(['from-assistant']);
    expect(p.body).toContain('**App:** books');
    expect(p.body).toContain('**Asked by:** 1 person (1 request)');
    expect(p.body).toContain(`/app/settings/roadmap?view=list&item=${id}`);
    expect(p.body).toContain('Necesito facturas recurrentes');
    expect(p.body).toContain(requesterRef(u.id));
    expect(p.body).not.toContain(u.email);
    expect(p.body).not.toContain(u.id);
    expect(p.body).not.toContain('Name fr-payload');
    expect(p.body).not.toContain('5555');
    expect(buildIssuePayload({ ...input, item: { ...input.item, priority: 1 } }).labels).toEqual(['from-assistant', 'priority']);
  });

  it('crea el issue una vez, después lo actualiza; una falla queda para el tick y no muestra el token', async () => {
    const token = 'test-token-not-real-123';
    vi.stubEnv('BACKLOG_GITHUB_REPO', 'example-org/backlog');
    vi.stubEnv('BACKLOG_GITHUB_TOKEN', token);
    const calls: Array<{ url: string; method: string; body: Record<string, unknown> }> = [];
    let fail = false;
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, method: String(init.method), body: JSON.parse(String(init.body)) });
      expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${token}`);
      if (fail) return new Response('{"message":"Bad credentials"}', { status: 401 });
      return new Response(JSON.stringify({ number: 42 }), { status: 201 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    const a = await person('fr-gh-a');
    const b = await person('fr-gh-b', 'example.org');
    const word = `Zq${tag()}`;
    // after() no existe fuera de una request: corre en línea con el fetch falso.
    await ask(a, { title: `Kanban ${word} view for Track cycles`, app: 'track' });
    const id = (await itemFor(`Kanban ${word}`))!.item_id;
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: 'https://api.github.com/repos/example-org/backlog/issues', method: 'POST' });
    expect(calls[0].body.labels).toEqual(['from-assistant']);
    expect(String(calls[0].body.body)).not.toContain(a.email);
    expect(await getRoadmapItem(id)).toMatchObject({ github_issue: 42, github_dirty: 0 });

    // Otro pedido igual, de alguien prioritario: actualiza el mismo issue y suma la etiqueta.
    vi.stubEnv('FEATURE_PRIORITY_EMAILS', b.email);
    await ask(b, { title: `Kanban ${word} view for Track cycles`, app: 'track' });
    expect(calls.slice(1).map((c) => `${c.method} ${c.url.replace('https://api.github.com/repos/example-org/backlog', '')}`)).toEqual(['PATCH /issues/42', 'POST /issues/42/labels']);
    expect(String(calls[1].body.body)).toContain('**Asked by:** 2 people (2 requests)');
    expect(calls[2].body.labels).toEqual(['from-assistant', 'priority']);

    // Falla: queda pendiente, el error no muestra el token, y el tick lo reintenta.
    fail = true;
    await ask(a, { title: `Kanban ${word} view for Track cycles` });
    const pending = (await getRoadmapItem(id))!;
    expect(Number(pending.github_dirty)).toBeGreaterThan(0);
    expect(Number(pending.github_attempts)).toBe(1);
    expect(errors).toHaveBeenCalled();
    expect(errors.mock.calls.flat().join(' ')).not.toContain(token);
    fail = false;
    const r = await syncPendingBacklogIssues({ limit: 500 });
    expect(r?.sent).toBeGreaterThanOrEqual(1);
    expect(await getRoadmapItem(id)).toMatchObject({ github_issue: 42, github_dirty: 0, github_attempts: 0 });
  });
});

describe('asistente', () => {
  it('las instrucciones piden anotar el pedido en vez de negarse', async () => {
    expect(FEATURE_REQUEST_GUIDANCE).toContain('never just refuse');
    expect(FEATURE_REQUEST_GUIDANCE).toContain('request_feature');
    expect(FEATURE_REQUEST_GUIDANCE).toMatch(/Never promise a date/);
    const names = toolsFor({ role: 'member', apps: [] } as unknown as SessionUser).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['request_feature', 'report_problem']));
    expect(toolsFor({ role: 'guest', apps: '*' } as unknown as SessionUser).map((t) => t.name)).not.toContain('request_feature');
  });

  it('"quiero que desde inbox pueda editar un campo de hubspot": llama a request_feature y lo dice en español', async () => {
    const u = await person('fr-turn');
    let system = '';
    setAssistantModelOverride(
      fakeModel((info: FakeCallInfo) => {
        system = info.system;
        return fakeAssistantStep(info);
      }),
    );
    const message = `quiero que desde inbox pueda editar un campo de hubspot zq${tag()}, two way sync`;
    const user = owner(u);
    const conv = await createConversation({ workspaceId: u.id, personId: u.id }, 'pedido');
    await addMessage(conv.id, 'user', message);
    const events: AssistantEvent[] = [];
    for await (const e of runAssistantTurn({ user, conversationId: conv.id, message, page: null, locale: 'en' })) events.push(e);

    expect(system).toContain(FEATURE_REQUEST_GUIDANCE);
    expect(system).not.toContain('say you cannot do it here');
    const call = events.find((e) => e.type === 'tool' && e.tool === 'request_feature');
    expect(call).toBeTruthy();
    const result = events.find((e) => e.type === 'tool-result' && e.tool === 'request_feature');
    expect(result).toMatchObject({ ok: true, output: { recorded: true } });
    const text = events.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('');
    expect(text).toMatch(/Anoté tu pedido para el equipo/);
    expect(text).not.toMatch(/No puedo/);
    const saved = (await listMessages(conv.id, 10)).filter((m) => m.role === 'assistant').pop()!;
    expect(saved.parts.some((p) => p.type === 'tool' && p.tool === 'request_feature' && p.ok)).toBe(true);

    const item = await itemFor('Request: desde inbox pueda editar');
    expect(item).toBeTruthy();
    expect(await getRoadmapItem(item!.item_id)).toMatchObject({ product: 'inbox', is_public: 0 });
  });
});
