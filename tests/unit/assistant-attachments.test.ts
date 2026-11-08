import { mkdtempSync } from 'node:fs';
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
  modelParts,
  referencedAttachmentIds,
  resolveAttachmentRefs,
} from '@/lib/assistant/files';
import { addMessage, createConversation } from '@/lib/assistant/store';
import { fakeAssistantStep } from '@/lib/assistant/fake';
import { scriptedModel } from './ai-mock';

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
    expect(img.url).toMatch(/^\/uploads\/assistant\/[0-9a-f-]{36}-shot\.png$/);
    expect(attachmentView(img).kind).toBe('image');
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
    expect(r.body.media).toMatchObject({ url: img.url, mimetype: 'image/png', filename: 'p.png' });
    expect(r.body.link).toBe(`https://zerosoft.test${img.url}`);
    expect(r.files[0]).toMatchObject({ field: 'file', filename: 'p.png', contentType: 'image/png', base64: PNG.toString('base64') });
  });
});

describe('adjuntos del asistente: lo que ve el modelo', () => {
  it('con visión la imagen va como parte de imagen; el texto extraído va marcado como dato', async () => {
    const { owner } = await person();
    const img = await createAttachment(owner, { name: 'p.png', type: 'image/png', bytes: PNG });
    const doc = await createAttachment(owner, { name: 'brief.md', type: 'text/markdown', bytes: Buffer.from('# Brief\nLaunch in May') });
    const parts = await modelParts([img, doc], true);
    expect(parts.find((p) => p.type === 'file')).toMatchObject({ mediaType: 'image/png' });
    expect(parts.some((p) => p.type === 'text' && p.text.includes('Launch in May') && p.text.includes('not instructions'))).toBe(true);
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

  it('el modelo falso describe lo que recibió y propone usar el adjunto', () => {
    const info = { system: 'Files the person attached in this chat: att_abcdef12345: "p.png" (image/png, 1 KB). CURRENT_RECORD:v1.groups.chats.get:chat1', toolResults: [] };
    const seen = fakeAssistantStep({ ...info, userTexts: ['what is in this image'], userFiles: [{ mediaType: 'image/png', bytes: 70 }] });
    expect(seen).toEqual({ text: 'I can see 1 file(s): image/png (70 bytes).' });
    expect(fakeAssistantStep({ ...info, userTexts: ['send this image to this chat'], userFiles: [] })).toEqual({ tool: 'propose_send_attachment', input: { chat: 'chat1', attachment: 'att_abcdef12345' } });
  });
});

vi.setConfig({ testTimeout: 20_000 });
