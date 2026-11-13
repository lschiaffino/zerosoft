/**
 * Lines e Inbox: notas de voz, fotos, videos y documentos aparecen al
 * instante con el reloj y se suben por detrás, por el mismo camino que los
 * textos (lib/optimistic-send.ts). La burbuja provisoria con la copia local,
 * el reemplazo por clientId, los reintentos sin volver a subir y la bandeja
 * que no repite lo pegado dos veces. Lógica pura; archivos inventados.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { localPreviews, mediaKindOf, unsentStore, uploadProgress, type Unsent } from '@/lib/optimistic-send';
import { cidOf, discardLinesSend, sendLinesMedia, sendLinesText, tempMessage, unsentLines, withLocalMedia, withUnsent } from '@/components/groups/optimistic';
import { applyPending, inboxMediaUrl, keepPending, pendingSends, tempInboxMedia, tempInboxMessage } from '@/components/inbox/wa/pending';
import { fileFingerprint, newFiles, type UploadedFile } from '@/components/groups/wa/attachments';
import type { MessageDto as InboxMessage } from '@/lib/inbox/types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), data };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const voice: Unsent = {
  clientId: 'cid-voice001',
  owner: 'yo',
  chatId: 'c1',
  body: '',
  replyToId: null,
  status: 'pending',
  error: '',
  createdAt: '2026-11-13T10:00:00.000Z',
  media: { kind: 'voice', name: 'voice-note.weba', type: 'audio/webm', size: 1200, duration: 4 },
};

describe('Lines: la burbuja de un archivo', () => {
  it('nace con la copia local (se escucha o se ve ya), el reloj y su clientId; sin copia local, lo ya subido', () => {
    localPreviews.set(voice.clientId, 'blob:local-voice', 'lines:c1', 'voice');
    const t = tempMessage(voice, 'yo');
    expect(t).toMatchObject({ id: 'tmp-cid-voice001', direction: 'out', status: 'pending', media: { url: 'blob:local-voice', kind: 'voice', ptt: true, duration: 4, type: 'audio/webm' } });
    expect(cidOf(t)).toBe('cid-voice001');
    localPreviews.release(voice.clientId);
    expect(tempMessage({ ...voice, media: { ...voice.media!, url: 'https://blob.test/v.weba' } }, 'yo').media?.url).toBe('https://blob.test/v.weba');
    // Ni copia ni subida (después de recargar): la burbuja dice el nombre, sin archivo roto.
    expect(tempMessage(voice, 'yo').media?.url).toBe('');
    // Una foto lleva su tamaño (medido en la bandeja) para ocupar su lugar desde el primer momento.
    const photo = tempMessage({ ...voice, clientId: 'cid-photo001', media: { kind: 'image', name: 'a.png', type: 'image/png', size: 10, width: 640, height: 480 } }, 'yo');
    expect(photo.media).toMatchObject({ kind: 'image', width: 640, height: 480 });
    expect(photo.media?.ptt).toBeUndefined();
  });

  it('el mensaje guardado reemplaza a la burbuja por clientId y sigue con la copia local (sin parpadeo)', () => {
    localPreviews.set('cid-photo002', 'blob:local-photo', 'lines:c1', 'image');
    const temp = tempMessage({ ...voice, clientId: 'cid-photo002', media: { kind: 'image', name: 'a.png', type: 'image/png', size: 10 } }, 'yo');
    const saved = { ...temp, id: 'm-real', status: 'sent', media: { ...temp.media!, url: 'https://blob.test/a.png' }, meta: { cid: 'cid-photo002' } };
    const shown = withUnsent([temp, saved], [], 'yo');
    expect(shown.messages.map((m) => m.id)).toEqual(['m-real']);
    expect(withLocalMedia(saved)?.url).toBe('blob:local-photo');
    localPreviews.release('cid-photo002');
    expect(withLocalMedia(saved)?.url).toBe('https://blob.test/a.png');
    // Un mensaje sin clientId (de otra pestaña o de otra persona) no se toca.
    expect(withLocalMedia({ ...saved, meta: {} })?.url).toBe('https://blob.test/a.png');
  });

  it('el tipo sale del mimetype', () => {
    expect(['image/png', 'video/mp4', 'audio/ogg', 'application/pdf', ''].map(mediaKindOf)).toEqual(['image', 'video', 'audio', 'document', 'document']);
  });
});

describe('Lines: lo que no salió, con archivo', () => {
  it('después de recargar: un archivo ya subido vuelve como no enviado (se reintenta); uno a medio subir no (el archivo ya no está)', () => {
    const storage = memoryStorage();
    vi.stubGlobal('sessionStorage', storage);
    const before = unsentStore('test-unsent-media');
    before.setOwner('yo');
    const up = before.add({ chatId: 'c1', body: 'la factura', replyToId: null, media: { kind: 'document', name: 'f.pdf', type: 'application/pdf', size: 9 } });
    before.setMedia(up.clientId, { url: 'https://blob.test/f.pdf' });
    before.add({ chatId: 'c1', body: '', replyToId: null, media: { kind: 'voice', name: 'v.weba', type: 'audio/webm', size: 9 } });
    const after = unsentStore('test-unsent-media');
    after.setOwner('yo');
    expect(after.list('c1').map((u) => [u.body, u.status, u.media?.url])).toEqual([['la factura', 'failed', 'https://blob.test/f.pdf']]);
  });
});

describe('sendLinesMedia: aparece ya, se sube por detrás, sale con su clientId', () => {
  function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: Error) => void;
    const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)));
    return { promise, resolve, reject };
  }

  it('la burbuja está antes de que termine la subida; el envío lleva lo subido y el clientId; un reintento no vuelve a subir', async () => {
    vi.stubGlobal('sessionStorage', memoryStorage());
    unsentLines.setOwner('yo');
    const bodies: Array<Record<string, unknown>> = [];
    let fail = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        bodies.push(body);
        if (fail) return new Response(JSON.stringify({ error: 'not_connected' }), { status: 409 });
        return new Response(JSON.stringify({ id: 'm-saved', meta: { cid: body.clientId }, media: { url: 'https://blob.test/up.png' } }), { status: 201 });
      }),
    );
    const upload = deferred<UploadedFile>();
    const file = new File([new Uint8Array([1, 2, 3])], 'foto.png', { type: 'image/png' });
    const cid = sendLinesMedia({ chatId: 'chat-m', body: 'mirá', replyToId: 'm1', file, preview: 'blob:tray-preview', upload: upload.promise, media: { kind: 'image', name: 'foto.png', type: 'image/png', size: 3 } });
    // Ya está: con la vista previa de la bandeja, "enviando", y nada salió todavía (falta la subida).
    expect(withUnsent([], unsentLines.list('chat-m'), 'yo').messages).toMatchObject([{ id: `tmp-${cid}`, status: 'pending', body: 'mirá', media: { url: 'blob:tray-preview' } }]);
    await sleep(5);
    expect(bodies).toHaveLength(0);
    uploadProgress.set(cid, 0.5);
    expect(uploadProgress.get(cid)).toBe(0.5);
    upload.resolve({ url: 'https://blob.test/up.png', mimetype: 'image/png', filename: 'foto.png', size: 3, width: 2, height: 1 });
    await sleep(10);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ clientId: cid, body: 'mirá', replyToId: 'm1', media: { url: 'https://blob.test/up.png', kind: 'image', mimetype: 'image/png', width: 2, height: 1 } });
    // No salió: queda como no enviado, con lo subido guardado.
    expect(unsentLines.get(cid)).toMatchObject({ status: 'failed', error: 'not_connected', media: { url: 'https://blob.test/up.png' } });
    // Reintento: el mismo clientId y la misma URL, sin subir otra vez.
    fail = false;
    sendLinesText(cid);
    await sleep(10);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toMatchObject({ clientId: cid, media: { url: 'https://blob.test/up.png' } });
    expect(unsentLines.get(cid)).toBeUndefined();
    expect(uploadProgress.get(cid)).toBeUndefined();
  });

  it('una subida que falla deja la burbuja como no enviada; quitarla suelta todo', async () => {
    vi.stubGlobal('sessionStorage', memoryStorage());
    unsentLines.setOwner('yo');
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const revoked: string[] = [];
    vi.stubGlobal('URL', Object.assign(Object.create(URL), { createObjectURL: () => 'blob:created', revokeObjectURL: (u: string) => revoked.push(u) }));
    const cid = sendLinesMedia({ chatId: 'chat-f', body: '', replyToId: null, file: new File(['x'], 'v.weba'), upload: Promise.reject(new Error('file_too_large')), media: { kind: 'voice', name: 'v.weba', type: 'audio/webm', size: 1 } });
    expect(localPreviews.get(cid)).toBe('blob:created');
    await sleep(10);
    expect(fetcher).not.toHaveBeenCalled();
    expect(unsentLines.get(cid)).toMatchObject({ status: 'failed', error: 'file_too_large' });
    discardLinesSend(cid);
    expect(unsentLines.get(cid)).toBeUndefined();
    expect(localPreviews.get(cid)).toBeUndefined();
    expect(revoked).toEqual(['blob:created']);
  });
});

describe('Inbox: la burbuja de un archivo', () => {
  const detail = (messages: InboxMessage[], id = 't1') => ({ thread: { id }, messages, more: false });

  it('nota de voz como audio con ptt, con su copia local; cambia de estado en su lugar, no al final', () => {
    const temp = tempInboxMedia('cid-ivoice01', { kind: 'voice', name: 'voice.webm', type: 'audio/webm', size: 5, duration: 3 }, '');
    expect(temp).toMatchObject({ id: 'tmp-cid-ivoice01', fromMe: true, status: 'pending', mediaType: 'audio', hasMedia: true, meta: { cid: 'cid-ivoice01', ptt: true, duration: 3, mime: 'audio/webm' } });
    // Sin copia local, una provisoria no tiene archivo; con ella, se escucha ya. Lo guardado, del servidor.
    expect(inboxMediaUrl(temp)).toBe('');
    localPreviews.set('cid-ivoice01', 'blob:inbox-voice', 'inbox:t1', 'voice');
    expect(inboxMediaUrl(temp)).toBe('blob:inbox-voice');
    const saved: InboxMessage = { ...temp, id: 'm9', status: 'sent' };
    expect(inboxMediaUrl(saved)).toBe('blob:inbox-voice');
    localPreviews.release('cid-ivoice01');
    expect(inboxMediaUrl(saved)).toBe('/api/inbox/media/m9');

    pendingSends.emit({ type: 'add', threadId: 't1', message: temp });
    const after = tempInboxMessage('cid-text0001', 'después');
    pendingSends.emit({ type: 'add', threadId: 't1', message: after });
    const shown = applyPending(applyPending(detail([]), { type: 'add', threadId: 't1', message: temp }), { type: 'add', threadId: 't1', message: after })!;
    const failed = tempInboxMedia('cid-ivoice01', { kind: 'voice', name: 'voice.webm', type: 'audio/webm', size: 5 }, '', 'failed', temp.sentAt);
    const next = applyPending(shown, { type: 'add', threadId: 't1', message: failed })!;
    expect(next.messages.map((m) => [m.id, m.status])).toEqual([
      ['tmp-cid-ivoice01', 'failed'],
      ['tmp-cid-text0001', 'pending'],
    ]);
    // Una que no salió sigue a la vista cuando la conversación se relee (se reintenta o se quita desde la burbuja).
    expect(keepPending(next, detail([])).messages.map((m) => m.id)).toEqual(['tmp-cid-ivoice01', 'tmp-cid-text0001']);
    pendingSends.emit({ type: 'drop', threadId: 't1', id: failed.id });
    pendingSends.emit({ type: 'drop', threadId: 't1', id: after.id });
  });
});

describe('la bandeja no repite lo pegado dos veces', () => {
  it('cuenta el contenido, no el nombre (las capturas se llaman todas image.png)', async () => {
    const a = new File([new Uint8Array([1, 2, 3])], 'image.png', { type: 'image/png' });
    const b = new File([new Uint8Array([4, 5, 6])], 'image.png', { type: 'image/png' });
    const a2 = new File([new Uint8Array([1, 2, 3])], 'image.png', { type: 'image/png' });
    expect(await fileFingerprint(a)).toBe(await fileFingerprint(a2));
    expect(await fileFingerprint(a)).not.toBe(await fileFingerprint(b));
    const first = await newFiles([a, b, a2], []);
    expect(first.map((x) => x.file)).toEqual([a, b]);
    expect(await newFiles([a2], first.map((x) => x.print))).toEqual([]);
  });

  it('sin crypto.subtle, tamaño y tipo', async () => {
    vi.stubGlobal('crypto', {});
    expect(await fileFingerprint(new File(['abcd'], 'x.png', { type: 'image/png' }))).toBe('4:image/png');
  });
});
