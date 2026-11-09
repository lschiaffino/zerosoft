/**
 * Chats de WhatsApp (Inbox y Lines): vista previa de links con caché,
 * transcripción una sola vez con resumen de los audios largos, forma de onda
 * y la transcripción privada de cada persona en Inbox. Datos inventados.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { cleanPreviewUrl, linkPreview, readTranscript, transcribeMessage } from '@/lib/wa-extras';
import { waveformFrom } from '@/lib/groups-media';
import { firstUrl, waveBars } from '@/components/groups/wa/format';
import { listMessages, listThreads, type AccountRow } from '@/lib/inbox/core';
import { connectWhatsapp, ingestWhatsappEvents } from '@/lib/inbox/whatsapp';
import { messageTranscript } from '@/lib/inbox/wa-actions';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('DOCS_UNFURL_FAKE', '1');
  vi.stubEnv('VOICE_TRANSCRIBE_PROVIDER', 'fake');
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
});
afterEach(() => vi.unstubAllEnvs());

describe('vista previa de links', () => {
  it('solo http(s) sin credenciales; se guarda y la segunda vez sale de la caché', async () => {
    expect(cleanPreviewUrl('javascript:alert(1)')).toBeNull();
    expect(cleanPreviewUrl('https://user:pw@example.test/x')).toBeNull();
    expect(cleanPreviewUrl('https://example.test/a#frag')).toBe('https://example.test/a');
    expect(firstUrl('mirá https://example.test/nota). y más')).toBe('https://example.test/nota');
    const url = `https://example.test/p/${Math.random().toString(36).slice(2)}`;
    const a = await linkPreview(url);
    expect(a).toMatchObject({ url, title: 'example.test page', site: 'example.test' });
    await getDb().prepare("UPDATE wa_link_previews SET title = 'Guardado' WHERE url = ?").run(url);
    expect((await linkPreview(url))!.title).toBe('Guardado');
    // Vencida (una semana): se vuelve a leer.
    expect((await linkPreview(url, new Date(Date.now() + 8 * 86_400_000)))!.title).toBe('example.test page');
  });
});

describe('forma de onda', () => {
  it('WhatsApp manda bytes 0..100 en base64; se pasan a barras', () => {
    const raw = Buffer.from(Array.from({ length: 64 }, (_, i) => (i * 3) % 101)).toString('base64');
    const w = waveformFrom(raw)!;
    expect(w).toHaveLength(64);
    expect(Math.max(...w)).toBeLessThanOrEqual(100);
    const bars = waveBars(w, 'x');
    expect(bars).toHaveLength(36);
    expect(bars.every((b) => b >= 0.18 && b <= 1)).toBe(true);
    expect(waveformFrom('abc')).toBeUndefined();
  });
});

describe('transcripción de audios', () => {
  it('una sola vez aunque se pida dos veces a la vez; los largos llevan resumen', async () => {
    const owner = (await makeUser('wax-tr')).id;
    let loads = 0;
    const load = async () => {
      loads++;
      return { data: Buffer.from('OggS fake audio'), mimetype: 'audio/ogg', seconds: 90 };
    };
    const [a, b] = await Promise.all([transcribeMessage('inbox', owner, 'm1', load), transcribeMessage('inbox', owner, 'm1', load)]);
    expect(loads).toBe(1);
    const done = [a, b].find((x) => x.status === 'done')!;
    expect(done.text.length).toBeGreaterThan(0);
    expect(done.summary).toMatch(/^Resumen:/);
    expect(await readTranscript('inbox', owner, 'm1')).toMatchObject({ status: 'done' });
    // Otra persona no ve la de esta.
    expect(await readTranscript('inbox', 'otra-persona', 'm1')).toBeNull();
    // Corto: sin resumen. Sin audio: falla y queda guardado como fallido.
    const short = await transcribeMessage('inbox', owner, 'm2', async () => ({ data: Buffer.from('x'), mimetype: 'audio/ogg', seconds: 5 }));
    expect(short.summary).toBe('');
    const bad = await transcribeMessage('inbox', owner, 'm3', async () => {
      throw new Error('gone');
    });
    expect(bad).toMatchObject({ status: 'failed', error: 'media_unavailable' });
  });
});

describe('Inbox: transcripción de un audio del chat', () => {
  let owner = '';
  let account: AccountRow;
  beforeAll(async () => {
    vi.stubEnv('GROUPS_FAKE', '1');
    vi.stubEnv('VOICE_TRANSCRIBE_PROVIDER', 'fake');
    owner = (await makeUser('wax-inbox')).id;
    account = (await connectWhatsapp(owner)).account;
    await getDb().prepare("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?").run(account.id);
    account = { ...account, status: 'connected' };
    await new Promise((r) => setTimeout(r, 1600));
  });

  it('se hace al pedirla, queda guardada y solo la ve la dueña', async () => {
    await ingestWhatsappEvents(account, [
      {
        type: 'message',
        chatId: '15550003001@s.whatsapp.net',
        isGroup: false,
        fromMe: false,
        senderPhone: '15550003001',
        senderName: 'Rita',
        providerMessageId: 'aud-wax-1',
        body: '',
        media: { url: '', type: 'audio/ogg', name: '', fetchRef: { providerMessageId: 'aud-wax-1', chatId: '15550003001@s.whatsapp.net', fromMe: false }, info: { kind: 'voice', ptt: true, duration: 3 } },
        timestamp: new Date().toISOString(),
      },
    ]);
    const th = (await listThreads(owner, { view: 'whatsapp' })).find((t) => t.handle === '15550003001')!;
    const msg = (await listMessages(owner, th.id)).messages.at(-1)!;
    expect(await messageTranscript(owner, msg.id, false)).toBeNull();
    const t = await messageTranscript(owner, msg.id, true);
    expect(t).toMatchObject({ status: 'done' });
    expect(await messageTranscript(owner, msg.id, false)).toMatchObject({ status: 'done', text: t!.text });
    const other = (await makeUser('wax-other')).id;
    await expect(messageTranscript(other, msg.id, true)).rejects.toMatchObject({ code: 'not_found' });
  });
});
