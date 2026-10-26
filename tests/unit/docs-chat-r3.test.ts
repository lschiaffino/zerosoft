import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import {
  createChatConversation,
  createChatMessage,
  createChatWidget,
  getChatConversation,
  getChatVisitor,
  getOrCreateChatVisitor,
  listChatMessages,
  listTyping,
  reopenExpiredSnoozesThrottled,
  setTyping,
  updateChatConversation,
} from '@/lib/chat-data';
import { sendErrorKey } from '@/lib/chat-schema';
import { countArchivedDocPages, createDocPage, listDocPageSummaries } from '@/lib/docs';
import { makeUser } from './helpers';

type FakeUser = { id: string; email: string; team?: { id: string } | null };
const session = vi.hoisted(() => ({ user: null as null | FakeUser }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: FakeUser) => u.id,
}));
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: (task: () => Promise<void>) => {
    void task().catch(() => {});
  },
}));

const widgetScript = await import('@/app/api/chat/widget.js/route');
const messagesRoute = await import('@/app/api/chat/messages/route');
const csatRoute = await import('@/app/api/chat/csat/route');
const typingRoute = await import('@/app/api/chat/typing/route');
const agentTypingRoute = await import('@/lib/routes/chat/conversations/[id]/typing/route');
const conversationsRoute = await import('@/app/api/chat/conversations/route');

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
let ipN = 0;
function jsonReq(url: string, method: string, body?: unknown) {
  ipN += 1;
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.13.${ipN >> 8}.${ipN & 255}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function setup(label: string, fields?: Parameters<typeof createChatWidget>[2]['fields']) {
  const owner = await makeUser(label);
  const widget = await createChatWidget(owner.id, null, { name: `${label} widget`, fields });
  const externalId = `ext-${crypto.randomUUID()}`;
  const visitor = await getOrCreateChatVisitor(widget.id, externalId);
  const conversation = await createChatConversation(widget.id, visitor.id);
  return { owner, widget, visitor, externalId, conversation };
}

/** Saca una función del script del widget para probarla sola. */
async function widgetFunction<T>(name: string, scope: Record<string, unknown>): Promise<T> {
  const { widget } = await setup(`wfn-${name}`);
  const res = await widgetScript.GET(new Request(`http://x/api/chat/widget.js?id=${widget.id}`));
  const src = await res.text();
  const start = src.indexOf(`  function ${name}(`);
  const end = src.indexOf('\n  }\n', start);
  expect(start).toBeGreaterThan(-1);
  const keys = Object.keys(scope);
  return new Function(...keys, `${src.slice(start, end + 4)}\nreturn ${name};`)(...keys.map((k) => scope[k])) as T;
}

beforeEach(() => {
  session.user = null;
});

describe('Widget: subida de archivos y adjuntos', () => {
  it('api() no pisa el content-type cuando el body es FormData', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch = (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(null);
    };
    const api = await widgetFunction<(p: string, o?: RequestInit) => unknown>('api', {
      fetch: fakeFetch,
      ORIGIN: 'http://o',
    });
    const form = new FormData();
    form.append('file', new Blob(['x']), 'a.png');
    api('/api/chat/messages/upload', { method: 'POST', body: form });
    api('/api/chat/messages', { method: 'POST', body: '{}' });
    expect(calls[0].init.headers).toBeUndefined();
    expect(calls[0].init.body).toBe(form);
    expect(calls[1].init.headers).toEqual({ 'content-type': 'application/json' });
  });

  it('messageAttachments acepta array o texto JSON', async () => {
    const fn = await widgetFunction<(m: unknown) => unknown[]>('messageAttachments', {});
    const a = { name: 'Q&A.pdf', url: '/u/q.pdf', size: 10, type: 'file' };
    expect(fn({ attachments: [a] })).toEqual([a]);
    expect(fn({ attachments: JSON.stringify([a]) })).toEqual([a]);
    expect(fn({ attachments: 'no-json' })).toEqual([]);
    expect(fn({})).toEqual([]);
  });

  it('el nombre del adjunto no se escapa dos veces (dom() ya crea un textNode)', async () => {
    const { widget } = await setup('wesc');
    const src = await (await widgetScript.GET(new Request(`http://x/api/chat/widget.js?id=${widget.id}`))).text();
    expect(src).not.toContain('escapeHtml(');
    expect(src).not.toContain("'Started chat'");
    expect(() => new Function(src)).not.toThrow();
  });

  it('GET /api/chat/messages devuelve attachments como array y sin user_id', async () => {
    const { owner, widget, externalId, conversation } = await setup('watt');
    const att = { name: 'Q&A.pdf', url: '/uploads/chat/q.pdf', size: 12, mime: 'application/pdf', type: 'file' as const };
    await createChatMessage(conversation.id, 'user', { body: 'te paso el pdf', userId: owner.id, attachments: [att] });
    const res = await messagesRoute.GET(
      jsonReq(`http://t/api/chat/messages?widgetId=${widget.id}&visitorId=${externalId}`, 'GET'),
    );
    const data = (await res.json()) as { messages: Array<Record<string, unknown>> };
    expect(data.messages[0].attachments).toEqual([att]);
    expect(data.messages[0]).not.toHaveProperty('user_id');
    expect(JSON.stringify(data)).not.toContain(owner.id);
  });
});

describe('Widget: formulario pre-chat', () => {
  const fields = [
    { id: 'f1', name: 'Empresa', required: true, type: 'text' as const },
    { id: 'f2', name: 'Email de trabajo', required: false, type: 'email' as const },
  ];

  it('guarda las respuestas con etiquetas, en metadata y como identidad', async () => {
    const { widget } = await setup('wform', fields);
    const externalId = `ext-${crypto.randomUUID()}`;
    const res = await messagesRoute.POST(
      jsonReq('http://t/api/chat/messages', 'POST', {
        widgetId: widget.id,
        visitorId: externalId,
        fields: { f1: 'Acme', f2: 'Ana@Acme.com', intruso: 'x' },
      }),
    );
    expect(res.status).toBe(201);
    const data = (await res.json()) as {
      conversation: { id: string };
      message: { body: string };
      visitor: { id: string; email: string | null };
    };
    expect(data.conversation.id).toBeTruthy();
    expect(data.message.body).toBe('Empresa: Acme\nEmail de trabajo: Ana@Acme.com');
    expect(data.visitor.email).toBe('ana@acme.com');
    const visitor = await getChatVisitor(data.visitor.id);
    expect(JSON.parse(visitor!.metadata)).toEqual({ form: { Empresa: 'Acme', 'Email de trabajo': 'Ana@Acme.com' } });
    const stored = await listChatMessages(data.conversation.id);
    expect(stored.map((m) => m.body)).toEqual(['Empresa: Acme\nEmail de trabajo: Ana@Acme.com']);
    expect(stored[0].body).not.toContain('intruso');
  });

  it('sin texto ni respuestas válidas es invalid_input', async () => {
    const { widget } = await setup('wform-empty', fields);
    const res = await messagesRoute.POST(
      jsonReq('http://t/api/chat/messages', 'POST', {
        widgetId: widget.id,
        visitorId: `ext-${crypto.randomUUID()}`,
        fields: { f1: '  ', otro: 'x' },
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe('Chat: rutas públicas sin campos internos', () => {
  it('POST /api/chat/csat responde solo { ok: true }', async () => {
    const { widget, externalId, conversation, owner } = await setup('wcsat');
    await updateChatConversation(conversation.id, { status: 'resolved', assignedTo: owner.id, priority: 'urgent' });
    const res = await csatRoute.POST(
      jsonReq('http://t/api/chat/csat', 'POST', {
        widgetId: widget.id,
        visitorId: externalId,
        conversationId: conversation.id,
        score: 5,
      }),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    expect((await getChatConversation(conversation.id))?.csat_score).toBe(5);
  });

  it('typing público devuelve solo sender_type (sin user id de agentes)', async () => {
    const { owner, widget, externalId, conversation } = await setup('wtyping');
    await setTyping(conversation.id, 'user', owner.id, 5);
    const url = `http://t/api/chat/typing?widgetId=${widget.id}&visitorId=${externalId}&conversationId=${conversation.id}`;
    const res = await typingRoute.GET(jsonReq(url, 'GET'));
    const data = (await res.json()) as { typing: unknown[] };
    expect(data.typing).toEqual([{ sender_type: 'user' }]);
  });
});

describe('Chat: inbox', () => {
  it('DELETE typing del agente borra su indicador (al pasar a nota interna)', async () => {
    const { owner, conversation } = await setup('wtyping-del');
    session.user = { id: owner.id, email: owner.email };
    await agentTypingRoute.POST(new Request('http://t', { method: 'POST' }), ctx(conversation.id));
    expect((await listTyping(conversation.id)).length).toBe(1);
    const res = await agentTypingRoute.DELETE(new Request('http://t', { method: 'DELETE' }), ctx(conversation.id));
    expect(res.status).toBe(200);
    expect(await listTyping(conversation.id)).toEqual([]);
  });

  it('invalid_assignee tiene mensaje propio', () => {
    expect(sendErrorKey('invalid_assignee')).toBe('errors.invalid_assignee');
  });

  it('un snooze vencido aparece en rows y en total del mismo poll', async () => {
    const { owner, widget, conversation } = await setup('wsnooze');
    await getDb()
      .prepare("UPDATE chat_conversations SET status = 'snoozed', snoozed_until = ? WHERE id = ?")
      .run(new Date(Date.now() - 60_000).toISOString(), conversation.id);
    session.user = { id: owner.id, email: owner.email, team: null };
    const res = await conversationsRoute.GET(
      new Request(`http://t/api/chat/conversations?widgetIds=${widget.id}&status=open`),
    );
    const data = (await res.json()) as { rows: Array<{ id: string }>; total: number };
    expect(data.rows.map((r) => r.id)).toEqual([conversation.id]);
    expect(data.total).toBe(1);
  });

  it('el barrido de snoozes corre como mucho una vez por minuto por widget', async () => {
    const { widget, conversation } = await setup('wsnooze-throttle');
    const now = Date.now();
    await reopenExpiredSnoozesThrottled([widget.id], now);
    await getDb()
      .prepare("UPDATE chat_conversations SET status = 'snoozed', snoozed_until = ? WHERE id = ?")
      .run(new Date(now - 1000).toISOString(), conversation.id);
    await reopenExpiredSnoozesThrottled([widget.id], now + 30_000);
    expect((await getChatConversation(conversation.id))?.status).toBe('snoozed');
    await reopenExpiredSnoozesThrottled([widget.id], now + 61_000);
    expect((await getChatConversation(conversation.id))?.status).toBe('open');
  });
});

describe('Docs: sidebar liviano', () => {
  it('listDocPageSummaries no trae content y la papelera se cuenta', async () => {
    const owner = await makeUser('dsum');
    const page = await createDocPage(owner.id, {
      title: 'Grande',
      content: [{ id: 'b1', type: 'paragraph', content: 'x'.repeat(5000) }],
    });
    const trashed = await createDocPage(owner.id, { title: 'Vieja' });
    await getDb().prepare('UPDATE docs_pages SET archived = 1 WHERE id = ?').run(trashed.id);
    const summaries = await listDocPageSummaries(owner.id);
    expect(summaries.map((p) => p.id)).toEqual([page.id]);
    // Sin content: el teamspace y la verificación de la wiki son livianos (sidebar y búsqueda).
    expect(Object.keys(summaries[0]).sort()).toEqual(['icon', 'id', 'parent_id', 'position', 'teamspace_id', 'title', 'updated_at', 'verified']);
    expect(await countArchivedDocPages(owner.id)).toBe(1);
    expect((await listDocPageSummaries(owner.id, { archived: true })).map((p) => p.id)).toEqual([trashed.id]);
  });
});
