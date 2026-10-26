import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import {
  createChatConversation,
  createChatMessage,
  createChatWidget,
  extractDocsText,
  getChatVisitor,
  getOrCreateChatVisitor,
  matchesTimeRange,
  setTyping,
  updateChatVisitor,
} from '@/lib/chat-data';
import { setBotTyping } from '@/lib/chat-bot-ai';
import { CHAT_UPLOAD_MAX, sendErrorKey } from '@/lib/chat-schema';
import { MAX_UPLOAD_SIZE } from '@/lib/uploads';
import { createDocPage, duplicateDocPage, updateDocPage } from '@/lib/docs';
import { DOCS_BLOCK_MAX, docPageUpdateSchema, docsPatchTooLong } from '@/lib/docs-schema';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | { id: string; email: string } }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
}));

const visitorRoute = await import('@/lib/routes/chat/visitors/[id]/route');
const identifyRoute = await import('@/app/api/chat/identify/route');
const readRoute = await import('@/app/api/chat/read/route');

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
let ipN = 0;
function jsonReq(url: string, method: string, body?: unknown) {
  ipN += 1;
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.12.${ipN >> 8}.${ipN & 255}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function setup(label: string) {
  const owner = await makeUser(label);
  const widget = await createChatWidget(owner.id, null, { name: `${label} widget` });
  const externalId = `ext-${crypto.randomUUID()}`;
  const visitor = await getOrCreateChatVisitor(widget.id, externalId);
  const conversation = await createChatConversation(widget.id, visitor.id);
  return { owner, widget, visitor, externalId, conversation };
}

beforeEach(() => {
  session.user = null;
});

describe('Chat: notas del visitante', () => {
  it('updateChatVisitor guarda notas (chat_visitors no tiene updated_at)', async () => {
    const { visitor } = await setup('vnotes');
    const updated = await updateChatVisitor(visitor.id, { notes: 'cliente VIP', name: 'Ana' });
    expect(updated?.notes).toBe('cliente VIP');
    expect(updated?.name).toBe('Ana');
  });

  it('PATCH con notes null borra la nota', async () => {
    const { owner, visitor } = await setup('vnotes-null');
    session.user = { id: owner.id, email: owner.email };
    const url = `http://t/api/chat/visitors/${visitor.id}`;
    const res1 = await visitorRoute.PATCH(jsonReq(url, 'PATCH', { notes: 'interna' }), ctx(visitor.id));
    expect(res1.status).toBe(200);
    const res2 = await visitorRoute.PATCH(jsonReq(url, 'PATCH', { notes: null }), ctx(visitor.id));
    expect(res2.status).toBe(200);
    expect((await getChatVisitor(visitor.id))?.notes).toBeNull();
  });

  it('las rutas públicas no exponen notas ni metadata del visitante', async () => {
    const { widget, visitor, externalId } = await setup('vnotes-public');
    await updateChatVisitor(visitor.id, { notes: 'secreto del agente', metadata: { plan: 'x' } });
    const res = await identifyRoute.GET(
      jsonReq(`http://t/api/chat/identify?widgetId=${widget.id}&externalId=${externalId}`, 'GET'),
    );
    const data = (await res.json()) as { visitor: Record<string, unknown> };
    expect(data.visitor.id).toBe(visitor.id);
    expect(data.visitor).not.toHaveProperty('notes');
    expect(data.visitor).not.toHaveProperty('metadata');
  });
});

describe('Chat: POST /api/chat/read', () => {
  it('no devuelve los mensajes (ni los de sistema internos)', async () => {
    const { widget, externalId, conversation } = await setup('read');
    await createChatMessage(conversation.id, 'system', { body: '[handoff] interno' });
    const res = await readRoute.POST(
      jsonReq('http://t/api/chat/read', 'POST', {
        widgetId: widget.id,
        visitorId: externalId,
        conversationId: conversation.id,
      }),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data).toEqual({ ok: true });
  });
});

describe('Chat: reglas de horario', () => {
  // 13:00 UTC = 10:00 en Buenos Aires (UTC-3).
  const at = new Date('2026-03-10T13:00:00Z');
  it('evalúa el rango en la zona del widget', () => {
    expect(matchesTimeRange('09:00-13:00', 'America/Argentina/Buenos_Aires', at)).toBe(true);
    expect(matchesTimeRange('13:30-17:00', 'America/Argentina/Buenos_Aires', at)).toBe(false);
  });
  it('sin zona, en UTC (no en la hora del proceso)', () => {
    expect(matchesTimeRange('12:30-13:30', null, at)).toBe(true);
    expect(matchesTimeRange('09:00-10:30', null, at)).toBe(false);
  });
});

describe('Chat: indicador de escribiendo', () => {
  it('el visitante no suma una fila por cada llamada', async () => {
    const { conversation } = await setup('typing');
    for (let i = 0; i < 4; i++) await setTyping(conversation.id, 'visitor', null, 5);
    for (let i = 0; i < 3; i++) await setBotTyping(conversation.id);
    const rows = (await getDb()
      .prepare('SELECT sender_type FROM chat_typing WHERE conversation_id = ?')
      .all(conversation.id)) as Array<{ sender_type: string }>;
    expect(rows.filter((r) => r.sender_type === 'visitor')).toHaveLength(1);
    expect(rows.filter((r) => r.sender_type === 'user')).toHaveLength(1);
  });

  it('limpia los indicadores vencidos', async () => {
    const { conversation } = await setup('typing-expired');
    await getDb()
      .prepare(
        "INSERT INTO chat_typing (id, conversation_id, sender_type, user_id, expires_at) VALUES (?, ?, 'visitor', NULL, ?)",
      )
      .run(crypto.randomUUID(), conversation.id, '2000-01-01T00:00:00.000Z');
    await setTyping(conversation.id, 'visitor', null, 5);
    const rows = (await getDb()
      .prepare('SELECT expires_at FROM chat_typing WHERE conversation_id = ?')
      .all(conversation.id)) as Array<{ expires_at: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].expires_at > '2001').toBe(true);
  });
});

describe('Chat: bot de Docs', () => {
  it('extractDocsText devuelve texto plano, sin tags ni entidades', () => {
    const content = JSON.stringify([
      { id: 'a', type: 'paragraph', content: 'Pagos <strong>Q&amp;A</strong> y <a href="https://x.test">link</a>' },
    ]);
    expect(extractDocsText(content)).toBe('Pagos Q&A y link');
  });
});

describe('Chat: errores al responder desde el inbox', () => {
  it('mapea los códigos del servidor a claves traducidas', () => {
    expect(sendErrorKey('file_too_large')).toBe('errors.fileTooLarge');
    expect(sendErrorKey('file_type_not_allowed')).toBe('errors.fileTypeNotAllowed');
    expect(sendErrorKey('invalid_input')).toBe('errors.invalid_input');
    expect(sendErrorKey(undefined)).toBe('errors.generic');
  });
  it('el tope del cliente coincide con el del servidor', () => {
    expect(CHAT_UPLOAD_MAX).toBe(MAX_UPLOAD_SIZE);
  });
});

describe('Docs: guardado', () => {
  it('docsPatchTooLong detecta un bloque o celda que el servidor rechazaría', () => {
    const big = 'x'.repeat(DOCS_BLOCK_MAX + 1);
    expect(docsPatchTooLong({ content: [{ content: 'ok' }] })).toBe(false);
    expect(docsPatchTooLong({ content: [{ content: big }] })).toBe(true);
    expect(docsPatchTooLong({ content: [{ content: '', rows: [['a', big]] }] })).toBe(true);
    expect(docsPatchTooLong({ title: 't'.repeat(501) })).toBe(true);
    // Coincide con el schema del servidor.
    expect(docPageUpdateSchema.safeParse({ content: [{ id: 'b', type: 'code', content: big }] }).success).toBe(false);
  });

  it('el schema conserva la indentación inicial y los saltos finales del código', () => {
    const code = '  key: value\n  other: 1\n';
    const parsed = docPageUpdateSchema.parse({ content: [{ id: 'b', type: 'code', content: code }] });
    expect(parsed.content?.[0].content).toBe(code);
  });
});

describe('Docs: duplicar', () => {
  it('no revive las subpáginas que estaban en la papelera', async () => {
    const owner = await makeUser('dup-trash');
    const root = await createDocPage(owner.id, { title: 'Onboarding' });
    await createDocPage(owner.id, { title: 'Activa', parent_id: root.id });
    const trashed = await createDocPage(owner.id, { title: 'Borrador viejo', parent_id: root.id });
    await updateDocPage(owner.id, trashed.id, { archived: true });

    const copy = await duplicateDocPage(owner.id, root.id);
    expect(copy).not.toBeNull();
    const children = (await getDb()
      .prepare('SELECT title, archived FROM docs_pages WHERE parent_id = ?')
      .all(copy!.id)) as Array<{ title: string; archived: number }>;
    expect(children.map((c) => c.title)).toEqual(['Activa (Copy)']);
  });
});
