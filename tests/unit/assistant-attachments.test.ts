import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { upsertUser } from '@/lib/db';
import type { SessionUser } from '@/lib/session';
import { setAssistantModelOverride } from '@/lib/assistant/config';
import { runAssistantTurn, type AssistantEvent } from '@/lib/assistant/engine';
import {
  AttachmentError,
  assistantVision,
  attachmentView,
  createAttachment,
  getAttachments,
  claimAttachments,
  modelParts,
  readAttachmentBytes,
  referencedAttachmentIds,
  sweepUnclaimedAttachments,
  resolveAttachmentRefs,
} from '@/lib/assistant/files';
import { addMessage, createConversation, deleteConversation } from '@/lib/assistant/store';
import { fakeAssistantStep } from '@/lib/assistant/fake';
import { scriptedModel } from './ai-mock';
import { fakeModel } from '@/lib/crm-ai-fake';
import { toolCtx, type WriteTool } from '@/lib/assistant/registry';
import { attachmentTools } from '@/lib/assistant/tools-attachments';
import { runCatalog } from '@/lib/assistant/tools-catalog';
import { getOperation, type Operation } from '@/lib/mcp/catalog';

// Sin cookie de sesión: todo corre con la identidad delegada del asistente.
vi.mock('next-auth', async (orig) => ({ ...(await orig<object>()), getServerSession: async () => null }));
// La ruta que sirve los adjuntos: la sesión la elige cada test.
let sessionUser: SessionUser | null = null;
vi.mock('@/lib/assistant/http', async (orig) => ({ ...(await orig<object>()), assistantUser: async () => sessionUser ?? (await import('next/server')).NextResponse.json({ error: 'unauthorized' }, { status: 401 }) }));
import { GET as fileRoute } from '@/lib/routes/assistant/files/[id]/route';

process.env.NEXTAUTH_URL = 'https://zerosoft.test';
process.env.RATE_LIMIT_DISABLED = 'true';

// PNG de 1×1.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

const uid = () => Math.random().toString(36).slice(2, 8);

beforeAll(() => {
  process.env.UPLOADS_DIR = mkdtempSync(path.join(os.tmpdir(), 'zs-asst-files-'));
});

afterEach(() => {
  setAssistantModelOverride(null);
  delete process.env.ASSISTANT_VISION;
});

async function person() {
  const id = `af-${uid()}`;
  const u = await upsertUser({ id, email: `${id}@example.com`, name: id, image: null });
  return { user: { ...u, role: 'owner', apps: '*' } as SessionUser, owner: { workspaceId: u.id, personId: u.id } };
}

describe('adjuntos del asistente: subida', () => {
  it('guarda con la lista permitida y el tope, y extrae el texto', async () => {
    const { owner } = await person();
    const img = await createAttachment(owner, { name: 'shot.png', type: 'image/png', bytes: PNG });
    // Privado: cifrado en el store, nunca bajo /uploads (que se sirve con la URL).
    expect(img.ref).toMatch(/^local:[0-9a-f-]{36}\.bin$/);
    const onDisk = readFileSync(path.join(process.env.UPLOADS_DIR!, 'assistant', img.ref.slice(6)));
    expect(onDisk.includes(PNG)).toBe(false);
    expect(await readAttachmentBytes(img)).toEqual(PNG);
    expect(attachmentView(img)).toMatchObject({ kind: 'image', url: `/api/assistant/files/${img.id}` });
    const txt = await createAttachment(owner, { name: 'notes.txt', type: 'text/plain', bytes: Buffer.from('Ship the order on Friday.') });
    expect(txt.text).toBe('Ship the order on Friday.');
    await expect(createAttachment(owner, { name: 'evil.html', type: 'text/html', bytes: Buffer.from('<script>') })).rejects.toBeInstanceOf(AttachmentError);
    await expect(createAttachment(owner, { name: 'big.png', type: 'image/png', bytes: Buffer.alloc(10 * 1024 * 1024 + 1) })).rejects.toMatchObject({ code: 'file_too_large' });
  });

  it('cada adjunto es de su persona: otro no lo resuelve', async () => {
    const a = await person();
    const b = await person();
    const img = await createAttachment(a.owner, { name: 'a.png', type: 'image/png', bytes: PNG });
    expect(await getAttachments(a.owner, [img.id])).toHaveLength(1);
    expect(await getAttachments(b.owner, [img.id])).toHaveLength(0);
    await expect(resolveAttachmentRefs(b.owner, { media: { $attachment: img.id } })).rejects.toThrow(/Unknown attachment/);
  });

  it('las referencias se resuelven: media, URL y multipart en base64', async () => {
    const { owner } = await person();
    const img = await createAttachment(owner, { name: 'p.png', type: 'image/png', bytes: PNG });
    const args = { body: { media: { $attachment: img.id }, link: `attachment:${img.id}` }, files: [{ field: 'file', attachment: img.id }] };
    expect([...referencedAttachmentIds(args)]).toEqual([img.id]);
    const r = (await resolveAttachmentRefs(owner, args)) as { body: { media: Record<string, unknown>; link: string }; files: Array<Record<string, unknown>> };
    // Solo para la acción confirmada: una copia pública aparte (como las subidas de Groups); el original sigue privado.
    expect(r.body.media).toMatchObject({ url: expect.stringMatching(/^\/uploads\/chat\/[0-9a-f-]{36}-p\.png$/), mimetype: 'image/png', filename: 'p.png' });
    expect(r.body.link).toBe(`https://zerosoft.test${r.body.media.url as string}`);
    expect(r.files[0]).toMatchObject({ field: 'file', filename: 'p.png', contentType: 'image/png', base64: PNG.toString('base64') });
  });

  it('solo las tres formas son referencias: un campo cualquiera llamado attachment no', () => {
    expect([...referencedAttachmentIds({ body: { attachment: 'att_abcdefgh12' } })]).toEqual([]);
    expect([...referencedAttachmentIds({ body: { notes: 'see attachment:att_abcdefgh12 later' } })]).toEqual([]);
    expect([...referencedAttachmentIds({ files: [{ field: 'file', attachment: 'att_abcdefgh12' }] })]).toEqual(['att_abcdefgh12']);
  });

  it('la ruta lo sirve solo a su dueño, con headers seguros', async () => {
    const a = await person();
    const b = await person();
    const img = await createAttachment(a.owner, { name: 'p.png', type: 'image/png', bytes: PNG });
    const txt = await createAttachment(a.owner, { name: 'x.txt', type: 'text/plain', bytes: Buffer.from('<script>alert(1)</script>') });
    const get = async (who: SessionUser, id: string) => {
      sessionUser = who;
      return fileRoute(new Request(`https://zerosoft.test/api/assistant/files/${id}`), { params: Promise.resolve({ id }) });
    };
    const ok = await get(a.user, img.id);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/png');
    expect(ok.headers.get('cache-control')).toBe('private, no-store');
    expect(Buffer.from(await ok.arrayBuffer())).toEqual(PNG);
    const asText = await get(a.user, txt.id);
    expect(asText.headers.get('content-type')).toBe('application/octet-stream');
    expect(asText.headers.get('content-security-policy')).toContain('sandbox');
    expect((await get(b.user, img.id)).status).toBe(404);
    sessionUser = null;
  });

  it('se borran con la charla, y el cron borra lo que nunca se mandó (24 h)', async () => {
    const { owner } = await person();
    const kept = await createAttachment(owner, { name: 'k.png', type: 'image/png', bytes: PNG });
    const conv = await createConversation(owner, 'x');
    await claimAttachments(owner, conv.id, [kept.id]);
    const keptFile = path.join(process.env.UPLOADS_DIR!, 'assistant', kept.ref.slice(6));
    expect(existsSync(keptFile)).toBe(true);
    await deleteConversation(owner, conv.id);
    expect(existsSync(keptFile)).toBe(false);
    expect(await getAttachments(owner, [kept.id])).toHaveLength(0);

    const loose = await createAttachment(owner, { name: 'l.png', type: 'image/png', bytes: PNG });
    expect(await sweepUnclaimedAttachments({ now: Date.now() })).toBe(0);
    const later = Date.now() + 25 * 60 * 60 * 1000;
    const [first, second] = await Promise.all([sweepUnclaimedAttachments({ now: later }), sweepUnclaimedAttachments({ now: later })]);
    expect(first + second).toBeGreaterThanOrEqual(1);
    expect(await getAttachments(owner, [loose.id])).toHaveLength(0);
    expect(existsSync(path.join(process.env.UPLOADS_DIR!, 'assistant', loose.ref.slice(6)))).toBe(false);
  });
});

describe('adjuntos del asistente: lo que ve el modelo', () => {
  it('con visión la imagen va como parte de imagen; el texto extraído va marcado como dato', async () => {
    const { owner } = await person();
    const img = await createAttachment(owner, { name: 'p.png', type: 'image/png', bytes: PNG });
    const doc = await createAttachment(owner, { name: 'brief.md', type: 'text/markdown', bytes: Buffer.from('# Brief\nLaunch in May') });
    const parts = await modelParts([img, doc], true);
    expect(parts.find((p) => p.type === 'file')).toMatchObject({ mediaType: 'image/png' });
    // Texto y nombre del archivo van marcados con nonce, como en el servidor MCP.
    expect(parts.some((p) => p.type === 'text' && /<untrusted_data source="attachment:att_[a-z0-9]+" nonce="[0-9a-f]{16}">\n"# Brief\\nLaunch in May"/.test(p.text))).toBe(true);
    expect(parts.some((p) => p.type === 'text' && p.text.includes(`source="attachment:${doc.id}:name"`))).toBe(true);
    const blind = await modelParts([img], false);
    expect(blind.every((p) => p.type === 'text')).toBe(true);
    expect(blind[0].type === 'text' && blind[0].text).toContain('cannot see images');
  });

  it('visión según el modelo, o ASSISTANT_VISION', () => {
    expect(assistantVision('assistant-fake')).toBe(true);
    expect(assistantVision('openrouter:deepseek/deepseek-v4.1-flash')).toBe(false);
    expect(assistantVision('openrouter:openai/gpt-4o')).toBe(true);
    process.env.ASSISTANT_VISION = '0';
    expect(assistantVision('assistant-fake')).toBe(false);
  });

  it('las partes llegan al modelo en el turno; sin visión, aviso no_vision', async () => {
    const { user, owner } = await person();
    const img = await createAttachment(owner, { name: 'p.png', type: 'image/png', bytes: PNG });
    for (const vision of ['1', '0']) {
      process.env.ASSISTANT_VISION = vision;
      const model = scriptedModel([{ text: 'ok' }]);
      setAssistantModelOverride(model);
      const conv = await createConversation(owner, 'what is this');
      await addMessage(conv.id, 'user', 'what is this', [{ type: 'attachment', ...attachmentView(img) }]);
      const events: AssistantEvent[] = [];
      for await (const e of runAssistantTurn({ user, conversationId: conv.id, message: 'what is this', page: null, locale: 'en' })) events.push(e);
      const prompt = JSON.stringify(model.doStreamCalls[0]?.prompt ?? model.doGenerateCalls[0]?.prompt);
      const sys = (model.doStreamCalls[0]?.prompt ?? []).find((m: { role: string }) => m.role === 'system') as { content: string } | undefined;
      expect(sys?.content).toContain(img.id);
      if (vision === '1') {
        expect(prompt).toContain('"mediaType":"image/png"');
        expect(events.some((e) => e.type === 'notice')).toBe(false);
      } else {
        expect(prompt).not.toContain('"mediaType":"image/png"');
        expect(prompt).toContain('cannot see images');
        expect(events).toContainEqual({ type: 'notice', code: 'no_vision' });
      }
    }
  });

  it('el modelo falso recibe los bytes de la imagen por el camino real del turno', async () => {
    process.env.ASSISTANT_VISION = '1';
    const { user, owner } = await person();
    const img = await createAttachment(owner, { name: 'p.png', type: 'image/png', bytes: PNG });
    setAssistantModelOverride(fakeModel(fakeAssistantStep));
    const conv = await createConversation(owner, 'what is this');
    await addMessage(conv.id, 'user', 'what is this', [{ type: 'attachment', ...attachmentView(img) }]);
    let text = '';
    for await (const e of runAssistantTurn({ user, conversationId: conv.id, message: 'what is this', page: null, locale: 'en' })) if (e.type === 'text') text += e.delta;
    expect(text).toBe(`I can see 1 file(s): image/png (${PNG.length} bytes).`);
  });

  it('el modelo falso describe lo que recibió y propone usar el adjunto', () => {
    const info = { system: 'Files the person attached in this chat: att_abcdef12345 (image/png, 1 KB). CURRENT_RECORD:v1.groups.chats.get:chat1', toolResults: [] };
    const seen = fakeAssistantStep({ ...info, userTexts: ['what is in this image'], userFiles: [{ mediaType: 'image/png', bytes: 70 }] });
    expect(seen).toEqual({ text: 'I can see 1 file(s): image/png (70 bytes).' });
    expect(fakeAssistantStep({ ...info, userTexts: ['send this image to this chat'], userFiles: [] })).toEqual({ tool: 'propose_send_attachment', input: { chat: 'chat1', attachment: 'att_abcdef12345' } });
  });
});

describe('adjuntos del asistente: acciones de punta a punta (rutas reales)', () => {
  const op = (id: string) => getOperation(id) as Operation;
  const attachTool = () => attachmentTools.find((t) => t.name === 'propose_attach_file') as WriteTool;

  it('a un issue de Track por su identificador y al final de una página de Docs', async () => {
    const { user, owner } = await person();
    const ctx = toolCtx(user, 'en');
    const att = await createAttachment(owner, { name: 'drop.png', type: 'image/png', bytes: PNG });
    const call = async (id: string, args: Record<string, unknown>): Promise<unknown> => ((await runCatalog(ctx, op(id), args, {})) as { data?: unknown }).data;

    const team = (await call('v1.track.teams.create', { body: { name: 'Eng', key: 'ENG' } })) as { id: string };
    const issue = (await call('v1.track.issues.create', { body: { projectId: team.id, title: 'Bug' } })) as { id: string; identifier: string };
    const toIssue = (await attachTool().prepare(ctx, { target: 'track_issue', id: issue.identifier, attachment: att.id })) as { input: Record<string, unknown>; summary: string };
    expect(toIssue.summary).toBe(`Attach "drop.png" to ${issue.identifier}`);
    expect(await attachTool().execute(ctx, toIssue.input)).toMatchObject({ ok: true });
    const rows = ((await call('track.issues.attachments.list', { path: { id: issue.id } })) as { rows: Array<{ filename: string }> }).rows;
    expect(rows.map((r) => r.filename)).toEqual(['drop.png']);

    const page = ((await call('v1.docs.pages.create', { body: { title: 'Specs' } })) as { data: { id: string } }).data;
    const toPage = (await attachTool().prepare(ctx, { target: 'docs_page', id: page.id, attachment: att.id })) as { input: Record<string, unknown> };
    expect(await attachTool().execute(ctx, toPage.input)).toMatchObject({ ok: true });
    const blocks = ((await call('v1.docs.pages.blocks.list', { path: { id: page.id } })) as { data: Array<{ type: string; url?: string }> }).data;
    expect(blocks.find((b) => b.type === 'image')?.url).toMatch(/^\/uploads\/docs\/.+-drop\.png$/);

    // Un adjunto ajeno no se puede usar.
    const other = await person();
    expect(await attachTool().prepare(toolCtx(other.user, 'en'), { target: 'docs_page', id: page.id, attachment: att.id })).toMatchObject({ error: 'unknown_attachment' });
  });
});

vi.setConfig({ testTimeout: 20_000 });
