import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import {
  createCannedResponse,
  createChatConversation,
  createChatWidget,
  getChatConversation,
  getOrCreateChatVisitor,
  listChatMessages,
  updateChatConversation,
} from '@/lib/chat-data';
import { DocsConflictError, createDocPage, getDocPageRow, updateDocPage } from '@/lib/docs';
import { makeUser } from './helpers';

type FakeUser = { id: string; email: string; role: string; team?: { id: string } | null };
const session = vi.hoisted(() => ({ user: null as null | FakeUser }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: FakeUser) => u.id,
  isWorkspaceAdmin: (u: FakeUser) => u.role === 'owner' || u.role === 'admin',
}));
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: (task: () => Promise<void>) => {
    void task().catch(() => {});
  },
}));

const pageRoute = await import('@/lib/routes/docs/pages/[id]/route');
const agentMessagesRoute = await import('@/lib/routes/chat/conversations/[id]/messages/route');
const widgetScript = await import('@/app/api/chat/widget.js/route');

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
function docReq(id: string, method: string, body?: unknown) {
  return new NextRequest(`http://t/api/docs/pages/${id}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
function asUser(u: { id: string; email: string }, role = 'owner') {
  session.user = { id: u.id, email: u.email, role };
}

/** Saca una función del script del widget para probarla sola. */
async function widgetFunction<T>(name: string, scope: Record<string, unknown>): Promise<T> {
  const owner = await makeUser(`wfn-${name}`);
  const widget = await createChatWidget(owner.id, null, { name: 'w' });
  const res = await widgetScript.GET(new Request(`http://x/api/chat/widget.js?id=${widget.id}`));
  const src = await res.text();
  const start = src.indexOf(`  function ${name}(`);
  const end = src.indexOf('\n  }\n', start);
  expect(start).toBeGreaterThan(-1);
  const keys = Object.keys(scope);
  return new Function(...keys, `${src.slice(start, end + 4)}\nreturn ${name};`)(...keys.map((k) => scope[k])) as T;
}

const para = (content: string) => ({ id: crypto.randomUUID(), type: 'paragraph' as const, content });

beforeEach(() => {
  session.user = null;
});

describe('Docs: concurrencia optimista al guardar', () => {
  it('un guardado hecho sobre una versión vieja se fusiona con lo de la otra persona (no la pisa)', async () => {
    const owner = await makeUser('dconf');
    const page = await createDocPage(owner.id, { title: 'P', content: [{ id: 'p1', type: 'paragraph', content: '' }] });
    const base = page.updated_at;
    await new Promise((r) => setTimeout(r, 5));
    // A guarda X en el párrafo.
    const afterA = await updateDocPage(owner.id, page.id, { content: [{ id: 'p1', type: 'paragraph', content: 'X' }], base_updated_at: base });
    expect(afterA?.updated_at).not.toBe(base);
    await new Promise((r) => setTimeout(r, 5));
    // B sigue con la base vieja y escribió en el mismo párrafo: quedan las dos (primero lo ya guardado).
    const afterB = await updateDocPage(owner.id, page.id, { content: [{ id: 'p1', type: 'paragraph', content: 'Y' }], base_updated_at: base });
    expect(afterB?.content[0].content).toBe('XY');
    // Una base que ya no está entre las revisiones: conflicto (el editor fusiona con la versión actual y reintenta).
    await expect(updateDocPage(owner.id, page.id, { content: [{ id: 'p1', type: 'paragraph', content: 'Z' }], base_updated_at: '2000-01-01T00:00:00.000Z' })).rejects.toBeInstanceOf(
      DocsConflictError,
    );
    expect((await getDocPageRow(page.id))?.content).toContain('XY');
  });

  it('PATCH con base vieja: 200 fusionado; sin la revisión base, 409; con la base actual, 200', async () => {
    const owner = await makeUser('dconf2');
    asUser(owner);
    const page = await createDocPage(owner.id, { title: 'P', content: [{ id: 'p1', type: 'paragraph', content: '' }] });
    await new Promise((r) => setTimeout(r, 5));
    const ok = await pageRoute.PATCH(docReq(page.id, 'PATCH', { content: [{ id: 'p1', type: 'paragraph', content: 'X' }], base_updated_at: page.updated_at }), ctx(page.id));
    expect(ok.status).toBe(200);
    await new Promise((r) => setTimeout(r, 5));
    const stale = await pageRoute.PATCH(docReq(page.id, 'PATCH', { content: [{ id: 'p1', type: 'paragraph', content: 'Y' }], base_updated_at: page.updated_at }), ctx(page.id));
    expect(stale.status).toBe(200);
    const merged = (await stale.json()) as { updated_at: string; merged: boolean; content: Array<{ content: string }> };
    expect(merged.merged).toBe(true);
    expect(merged.content[0].content).toBe('XY');
    const gone = await pageRoute.PATCH(docReq(page.id, 'PATCH', { content: [para('Z')], base_updated_at: '2000-01-01T00:00:00.000Z' }), ctx(page.id));
    expect(gone.status).toBe(409);
    const next = await pageRoute.PATCH(docReq(page.id, 'PATCH', { content: [para('Z')], base_updated_at: merged.updated_at }), ctx(page.id));
    expect(next.status).toBe(200);
  });
});

describe('Docs: papelera y subpáginas', () => {
  it('borrar para siempre el padre no se lleva una subpágina ya restaurada', async () => {
    const owner = await makeUser('dtrash');
    const parent = await createDocPage(owner.id, { title: 'Proyectos' });
    const child = await createDocPage(owner.id, { title: 'Roadmap', parent_id: parent.id });
    await updateDocPage(owner.id, parent.id, { archived: true });
    expect((await getDocPageRow(child.id))?.archived).toBe(1);

    // Restaurar la hija con el padre todavía en la papelera: pasa a la raíz.
    await updateDocPage(owner.id, child.id, { archived: false });
    const restored = await getDocPageRow(child.id);
    expect(restored?.archived).toBe(0);
    expect(restored?.parent_id).toBeNull();

    asUser(owner);
    const res = await pageRoute.DELETE(docReq(parent.id, 'DELETE'), ctx(parent.id));
    expect(res.status).toBe(204);
    expect(await getDocPageRow(parent.id)).toBeNull();
    expect((await getDocPageRow(child.id))?.archived).toBe(0);
  });

  it('borrar el padre despega una hija activa aunque haya quedado colgando de él', async () => {
    const owner = await makeUser('dtrash2');
    const parent = await createDocPage(owner.id, { title: 'P' });
    const child = await createDocPage(owner.id, { title: 'C', parent_id: parent.id });
    const grand = await createDocPage(owner.id, { title: 'G', parent_id: child.id });
    await updateDocPage(owner.id, parent.id, { archived: true });
    // Estado heredado (antes del fix): hija activa con padre archivado.
    await getDb().prepare('UPDATE docs_pages SET archived = 0 WHERE id IN (?, ?)').run(child.id, grand.id);
    asUser(owner);
    expect((await pageRoute.DELETE(docReq(parent.id, 'DELETE'), ctx(parent.id))).status).toBe(204);
    expect((await getDocPageRow(child.id))?.parent_id).toBeNull();
    expect((await getDocPageRow(grand.id))?.parent_id).toBe(child.id);
  });

  it('restaurar el padre no revive una subpágina que se archivó por su cuenta', async () => {
    const owner = await makeUser('drevive');
    const faq = await createDocPage(owner.id, { title: 'FAQ' });
    const old = await createDocPage(owner.id, { title: 'Precios 2024', parent_id: faq.id });
    const keep = await createDocPage(owner.id, { title: 'Envíos', parent_id: faq.id });
    await updateDocPage(owner.id, old.id, { published: true });
    await updateDocPage(owner.id, old.id, { archived: true });
    await updateDocPage(owner.id, faq.id, { archived: true });
    await updateDocPage(owner.id, faq.id, { archived: false });
    expect((await getDocPageRow(keep.id))?.archived).toBe(0);
    expect((await getDocPageRow(old.id))?.archived).toBe(1);
  });

  it('un member no puede borrar para siempre; un admin sí', async () => {
    const owner = await makeUser('dperm');
    const page = await createDocPage(owner.id, { title: 'Wiki' });
    asUser(owner, 'member');
    expect((await pageRoute.DELETE(docReq(page.id, 'DELETE'), ctx(page.id))).status).toBe(403);
    expect(await getDocPageRow(page.id)).not.toBeNull();
    asUser(owner, 'admin');
    expect((await pageRoute.DELETE(docReq(page.id, 'DELETE'), ctx(page.id))).status).toBe(204);
  });
});

describe('Chat: macros, adjuntos y alta de visitantes', () => {
  async function setup(label: string) {
    const owner = await makeUser(label);
    const widget = await createChatWidget(owner.id, null, { name: `${label} widget` });
    const visitor = await getOrCreateChatVisitor(widget.id, `ext-${crypto.randomUUID()}`);
    const conversation = await createChatConversation(widget.id, visitor.id);
    return { owner, widget, conversation };
  }
  const post = (id: string, body: unknown) =>
    agentMessagesRoute.POST(
      new Request(`http://t/api/chat/conversations/${id}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      ctx(id),
    );

  it('una macro "responder y resolver" deja la conversación resuelta al enviar', async () => {
    const { owner, widget, conversation } = await setup('cmacro');
    const canned = await createCannedResponse(widget.id, { shortcut: 'cerrar', title: 'Cerrar', body: 'Gracias, cierro el ticket' });
    await getDb()
      .prepare('UPDATE chat_canned_responses SET actions = ? WHERE id = ?')
      .run(JSON.stringify({ status: 'resolved' }), canned.id);
    asUser(owner);
    const res = await post(conversation.id, { body: 'Gracias, cierro el ticket', cannedId: canned.id });
    expect(res.status).toBe(201);
    expect((await getChatConversation(conversation.id))?.status).toBe('resolved');
  });

  it('una respuesta normal sigue reabriendo una conversación resuelta', async () => {
    const { owner, conversation } = await setup('creopen');
    await updateChatConversation(conversation.id, { status: 'resolved' });
    asUser(owner);
    expect((await post(conversation.id, { body: 'hola de nuevo' })).status).toBe(201);
    expect((await getChatConversation(conversation.id))?.status).toBe('open');
  });

  it('la macro de otro widget se ignora', async () => {
    const { owner, conversation } = await setup('cmacro2');
    const other = await setup('cmacro3');
    const canned = await createCannedResponse(other.widget.id, { shortcut: 'x', title: 'x', body: 'x' });
    await getDb()
      .prepare('UPDATE chat_canned_responses SET actions = ? WHERE id = ?')
      .run(JSON.stringify({ status: 'resolved' }), canned.id);
    asUser(owner);
    await post(conversation.id, { body: 'hola', cannedId: canned.id });
    expect((await getChatConversation(conversation.id))?.status).toBe('open');
  });

  it('el POST JSON del agente ignora attachments (solo entran por /attachments)', async () => {
    const { owner, conversation } = await setup('catt');
    asUser(owner);
    const res = await post(conversation.id, {
      body: 'ver',
      attachments: [{ name: 'Factura.pdf', url: 'javascript:alert(1)', type: 'file', size: 1, mime: 'application/pdf' }],
    });
    expect(res.status).toBe(201);
    const msgs = await listChatMessages(conversation.id);
    expect(JSON.stringify(msgs)).not.toContain('javascript:');
  });

  it('dos altas en paralelo del mismo visitante no fallan y devuelven el mismo', async () => {
    const owner = await makeUser('cvis');
    const widget = await createChatWidget(owner.id, null, { name: 'w' });
    const ext = `ext-${crypto.randomUUID()}`;
    const [a, b] = await Promise.all([getOrCreateChatVisitor(widget.id, ext), getOrCreateChatVisitor(widget.id, ext)]);
    expect(a.id).toBe(b.id);
  });
});

describe('Widget: envío, adjuntos y recibos de lectura', () => {
  it('safeUrl solo deja http(s) y rutas del propio server', async () => {
    const safeUrl = await widgetFunction<(u: unknown) => string | null>('safeUrl', { ORIGIN: 'https://app' });
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('JaVaScRiPt:alert(1)')).toBeNull();
    expect(safeUrl('data:text/html,x')).toBeNull();
    expect(safeUrl('//evil.com/x')).toBeNull();
    expect(safeUrl('/\\evil.com/x')).toBeNull();
    expect(safeUrl(42)).toBeNull();
    expect(safeUrl('https://blob/x.pdf')).toBe('https://blob/x.pdf');
    expect(safeUrl('/uploads/chat/x.pdf')).toBe('https://app/uploads/chat/x.pdf');
  });

  it('sendMessage no muestra como enviado un mensaje rechazado y devuelve el texto', async () => {
    const appended: unknown[] = [];
    const errors: Array<[string, string]> = [];
    const send = await widgetFunction<(b: string) => void>('sendMessage', {
      formRequest: null,
      pendingOutbound: null,
      selectedFile: null,
      sendError: { style: {} },
      withIdentity: (x: unknown) => x,
      WIDGET_ID: 'w',
      visitorId: 'v',
      MAX_MESSAGE: 5000,
      conversationId: null,
      lastMessageId: null,
      api: () => Promise.resolve({ ok: false, status: 429, json: () => Promise.resolve({ error: 'rate_limited' }) }),
      appendMessage: (m: unknown) => appended.push(m),
      showSendError: (msg: string, body: string) => errors.push([msg, body]),
      sendFile: () => {},
      // Textos del widget (chat.visitorWidget): acá alcanza con la clave.
      T: (key: string) => key,
    });
    send('hola');
    await new Promise((r) => setTimeout(r, 0));
    expect(appended).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual(['tooMany', 'hola']);
  });

  it('sendMessage espera al formulario pre-chat antes de mandar', async () => {
    let release: () => void = () => {};
    const formRequest = new Promise<void>((r) => (release = r));
    const calls: string[] = [];
    const send = await widgetFunction<(b: string) => void>('sendMessage', {
      formRequest,
      pendingOutbound: null,
      selectedFile: null,
      sendError: { style: {} },
      withIdentity: (x: unknown) => x,
      WIDGET_ID: 'w',
      visitorId: 'v',
      MAX_MESSAGE: 5000,
      conversationId: null,
      lastMessageId: null,
      api: (_p: string, o: { body: string }) => {
        calls.push(o.body);
        return new Promise(() => {});
      },
      appendMessage: () => {},
      showSendError: () => {},
      sendFile: () => {},
    });
    send('hola');
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual([]);
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0])).toMatchObject({ body: 'hola' });
  });

  it('updateReadReceipts marca como leídas las burbujas ya mostradas', async () => {
    const marked: string[] = [];
    const bubble = {};
    const fn = await widgetFunction<(l: unknown[]) => void>('updateReadReceipts', {
      visitorBubbles: { m1: bubble, m2: {} },
      markBubbleRead: (id: string, b: unknown) => {
        expect(b).toBe(bubble);
        marked.push(id);
      },
    });
    fn([
      { id: 'm1', sender_type: 'visitor', read_at: '2026-01-01' },
      { id: 'm2', sender_type: 'visitor', read_at: null },
      { id: 'm3', sender_type: 'user', read_at: '2026-01-01' },
    ]);
    expect(marked).toEqual(['m1']);
  });

  it('el script del widget sigue siendo JS válido y limita el largo del input', async () => {
    const owner = await makeUser('wsrc');
    const widget = await createChatWidget(owner.id, null, { name: 'w' });
    const src = await (await widgetScript.GET(new Request(`http://x/api/chat/widget.js?id=${widget.id}`))).text();
    expect(() => new Function(src)).not.toThrow();
    expect(src).toContain('var MAX_MESSAGE = 5000;');
    expect(src).toContain("maxlength: String(MAX_MESSAGE)");
  });
});
