'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { MessageDto } from '@/lib/inbox/types';
import { measureImage, newFiles, type TrayItem } from '@/components/groups/wa/attachments';
import { MessageMenu, type MenuItem } from '@/components/groups/wa/Menu';
import { DocIcon, PhotoIcon, Plus, SendIcon, Trash } from '@/components/groups/wa/icons';
import { MEDIA_SEND_TIMEOUT_MS, inboxQueue, pendingSends, tempInboxMedia } from './pending';
import { withTimeout } from '@/lib/conditional-fetch';
import { TEMP_PREFIX, localPreviews, mediaKindOf, newClientId, uploadProgress, type UnsentMedia, type UnsentMediaKind } from '@/lib/optimistic-send';
import { duration } from '@/components/groups/wa/format';
import LiveWaveform from '@/components/groups/wa/LiveWaveform';

/** Lo que entra en un pedido (como lib/inbox/wa-media.ts); más grande va directo a Blob. */
const INLINE_MAX = 4 * 1024 * 1024;
const MAX_FILES = 30;
let seq = 0;

type Sent = { messages: MessageDto[] };

/**
 * Manda un archivo: chico por el pedido (con avance), grande por Blob y después la URL. Siempre por la cola del chat
 * y con su clientId (el mismo si se vuelve a mandar desde la bandeja: un reintento no lo duplica).
 */
async function sendOne(
  threadId: string,
  f: { file: Blob; name: string; caption?: string; kind?: string; duration?: number; replyTo?: string; clientId?: string },
  onProgress: (p: number) => void,
): Promise<Sent> {
  if (f.file.size <= INLINE_MAX) {
    return inboxQueue(threadId)(() => new Promise<Sent>((resolve, reject) => {
      const form = new FormData();
      form.append('file', f.file, f.name);
      if (f.caption) form.append('caption', f.caption);
      if (f.kind) form.append('kind', f.kind);
      if (f.duration) form.append('duration', String(f.duration));
      if (f.replyTo) form.append('replyTo', f.replyTo);
      if (f.clientId) form.append('clientId', f.clientId);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/inbox/threads/${threadId}/media`);
      xhr.timeout = MEDIA_SEND_TIMEOUT_MS;
      xhr.ontimeout = () => reject(new Error('network'));
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      xhr.onload = () => {
        let data: Partial<Sent> & { error?: string } = {};
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          // Sin JSON: error genérico.
        }
        if (xhr.status >= 200 && xhr.status < 300 && data.messages) resolve(data as Sent);
        else reject(new Error(data.error || 'send_failed'));
      };
      xhr.onerror = () => reject(new Error('network'));
      xhr.send(form);
    }));
  }
  const { upload } = await import('@vercel/blob/client');
  const safe = (f.name || 'file').replace(/[^\w.-]+/g, '_').slice(-120) || 'file';
  let url: string;
  try {
    const blob = await upload(`inbox/${crypto.randomUUID()}-${safe}`, f.file, {
      access: 'public',
      handleUploadUrl: '/api/inbox/upload/blob',
      onUploadProgress: (e) => onProgress(e.percentage / 100),
    });
    url = blob.url;
  } catch {
    throw new Error('file_too_large');
  }
  // Por la cola del chat (./pending.ts): un archivo o una nota de voz no se adelanta a un texto que todavía está saliendo.
  const res = await inboxQueue(threadId)(() =>
    fetch(`/api/inbox/threads/${threadId}/media`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, mimetype: f.file.type, filename: f.name, size: f.file.size, caption: f.caption, kind: f.kind, duration: f.duration, replyTo: f.replyTo, clientId: f.clientId }),
      signal: withTimeout(undefined, MEDIA_SEND_TIMEOUT_MS),
    }).catch(() => null),
  );
  const data = ((await res?.json().catch(() => ({}))) ?? {}) as Partial<Sent> & { error?: string };
  if (!res?.ok || !data.messages) throw new Error(data.error || 'send_failed');
  return data as Sent;
}

/** Un archivo que se mandó desde esta pestaña y todavía no está guardado: saliendo, o no salió (con el archivo, para reintentar). */
interface OutgoingMedia {
  threadId: string;
  file: Blob;
  caption: string;
  media: UnsentMedia;
  replyTo?: string;
  sentAt: string;
  running: boolean;
  onError?: (code: string) => void;
}

const outbox = new Map<string, OutgoingMedia>();

/**
 * Manda un archivo con la burbuja ya a la vista: aparece con la copia local y el reloj, se sube y se manda por detrás
 * (por la cola del chat, con su clientId), y la página del servidor la reemplaza. Si no sale, la burbuja queda como
 * no enviada, con reintentar (el mismo clientId: no se duplica) o quitar. Todo con el chat de cuando se mandó.
 */
export function sendInboxMedia(input: {
  threadId: string;
  file: Blob;
  name: string;
  caption?: string;
  kind?: UnsentMediaKind;
  duration?: number;
  width?: number;
  height?: number;
  replyTo?: string;
  /** Vista previa local que ya existe (la de la bandeja); si no, se crea una. */
  preview?: string;
  onError?: (code: string) => void;
}): string {
  const clientId = newClientId();
  const type = input.file.type || 'application/octet-stream';
  const media: UnsentMedia = { kind: input.kind ?? mediaKindOf(type), name: input.name, type, size: input.file.size, width: input.width, height: input.height, duration: input.duration };
  const preview = input.preview || (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(input.file) : '');
  if (preview) localPreviews.set(clientId, preview, `inbox:${input.threadId}`, media.kind);
  outbox.set(clientId, { threadId: input.threadId, file: input.file, caption: input.caption ?? '', media, replyTo: input.replyTo, sentAt: new Date().toISOString(), running: false, onError: input.onError });
  run(clientId);
  return clientId;
}

function run(clientId: string): void {
  const job = outbox.get(clientId);
  if (!job || job.running) return;
  job.running = true;
  const { threadId } = job;
  const temp = tempInboxMedia(clientId, job.media, job.caption, 'pending', job.sentAt);
  pendingSends.emit({ type: 'add', threadId, message: temp });
  const kind = job.media.kind === 'voice' || job.media.kind === 'sticker' ? job.media.kind : undefined;
  sendOne(threadId, { file: job.file, name: job.media.name, caption: job.caption || undefined, kind, duration: job.media.duration, replyTo: job.replyTo, clientId }, (p) => uploadProgress.set(clientId, p)).then(
    (r) => {
      outbox.delete(clientId);
      uploadProgress.clear(clientId);
      const saved = r.messages.find((m) => m.meta?.cid === clientId);
      localPreviews.settle(clientId, saved ? `/api/inbox/media/${saved.id}` : undefined);
      // La página del servidor de ESE chat, que ya trae el mensaje guardado: la burbuja provisoria se va.
      pendingSends.emit({ type: 'sent', threadId, messages: r.messages, id: temp.id });
    },
    (err: Error) => {
      job.running = false;
      uploadProgress.clear(clientId);
      pendingSends.emit({ type: 'add', threadId, message: tempInboxMedia(clientId, job.media, job.caption, 'failed', job.sentAt) });
      job.onError?.(err.message || 'send_failed');
    },
  );
}

/** Vuelve a mandar el archivo de una burbuja que no salió (la misma burbuja, otra vez con el reloj). */
export function retryInboxMedia(tempId: string): void {
  run(tempId.slice(TEMP_PREFIX.length));
}

/** Se descarta un archivo que no salió: su burbuja y su copia local. */
export function discardInboxMedia(tempId: string): void {
  const clientId = tempId.slice(TEMP_PREFIX.length);
  const job = outbox.get(clientId);
  if (!job || job.running) return;
  outbox.delete(clientId);
  localPreviews.release(clientId);
  pendingSends.emit({ type: 'drop', threadId: job.threadId, id: tempId });
}

/**
 * Los archivos elegidos, arrastrados o pegados, antes de mandar (como la
 * vista previa de WhatsApp Web): uno por uno con su comentario, en orden.
 * Lo que falla queda en la bandeja para reintentar o sacar.
 */
export function useSendTray(threadId: string, onError?: (code: string) => void) {
  const [items, setItems] = useState<TrayItem[]>([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const patch = (key: string, p: Partial<TrayItem>) => setItems((l) => l.map((x) => (x.key === key ? { ...x, ...p } : x)));

  const add = useCallback(async (files: File[]) => {
    // Lo que ya está en la bandeja no entra otra vez (pegar la misma captura dos veces).
    const fresh = await newFiles(files, itemsRef.current.map((x) => x.print));
    const room = MAX_FILES - itemsRef.current.length;
    const next = fresh.slice(0, Math.max(0, room)).map<TrayItem>(({ file, print }) => ({
      key: `s${++seq}`,
      file,
      name: file.name || 'file',
      type: file.type || 'application/octet-stream',
      size: file.size,
      preview: /^(image|video)\//.test(file.type) ? URL.createObjectURL(file) : '',
      progress: 0,
      status: 'ready',
      print,
    }));
    if (!next.length) return;
    setItems((l) => [...l, ...next]);
    for (const it of next) if (it.type.startsWith('image/')) void measureImage(it.preview).then((d) => d && patch(it.key, d));
  }, []);

  const remove = useCallback((key: string) => {
    setItems((l) => {
      const it = l.find((x) => x.key === key);
      if (it?.preview) URL.revokeObjectURL(it.preview);
      return l.filter((x) => x.key !== key);
    });
  }, []);

  const clear = useCallback(() => {
    setItems((l) => {
      l.forEach((it) => it.preview && URL.revokeObjectURL(it.preview));
      return [];
    });
  }, []);

  /**
   * Manda todo: cada archivo aparece ya en el chat como su burbuja (con la vista previa de la bandeja) y se sube por
   * detrás; la bandeja se cierra enseguida. Lo que no sale queda en el chat como no enviado, con reintentar.
   */
  const sendAll = useCallback(
    (replyTo?: string) => {
      const list = itemsRef.current;
      list.forEach((it, i) =>
        sendInboxMedia({ threadId, file: it.file, name: it.name, caption: it.caption?.trim(), width: it.width, height: it.height, replyTo: i === 0 ? replyTo : undefined, preview: it.preview, onError }),
      );
      // Las vistas previas pasaron a las burbujas: salen de la bandeja sin soltarlas.
      itemsRef.current = [];
      setItems([]);
      return list.length > 0;
    },
    [threadId, onError],
  );

  const setCaption = useCallback((key: string, caption: string) => patch(key, { caption }), []);
  const retry = useCallback((key: string) => patch(key, { status: 'ready', error: undefined }), []);

  useEffect(() => () => itemsRef.current.forEach((it) => it.preview && URL.revokeObjectURL(it.preview)), []);
  useEffect(() => clear(), [threadId, clear]);

  return { items, add, remove, clear, sendAll, setCaption, retry, sending: false };
}

/** "+" del campo: documento o fotos y videos (como el menú de adjuntar de WhatsApp Web). */
export function AttachButton({ onFiles, disabled, extra = [] }: { onFiles: (files: File[]) => void; disabled?: boolean; /** Lo que el composer suma al menú (escribir con AI, dictar, snippets). */ extra?: MenuItem[] }) {
  const w = useTranslations('inboxWa');
  const docs = useRef<HTMLInputElement>(null);
  const media = useRef<HTMLInputElement>(null);
  const pick = (input: HTMLInputElement | null) => {
    if (!input) return;
    input.value = '';
    input.click();
  };
  return (
    <span className="ib-wa-attach">
      {disabled ? (
        <button type="button" className="wa-icon-btn" disabled aria-label={w('attach')}>
          <Plus size={24} />
        </button>
      ) : (
        <MessageMenu
          label={w('attach')}
          trigger={<Plus size={24} />}
          className="wa-icon-btn wa-attach"
          align="left"
          items={[
            { key: 'doc', label: w('attachDocument'), icon: <DocIcon size={16} />, onSelect: () => pick(docs.current) },
            { key: 'photo', label: w('attachMedia'), icon: <PhotoIcon size={16} />, onSelect: () => pick(media.current) },
            ...extra,
          ]}
        />
      )}
      <input ref={docs} type="file" multiple hidden onChange={(e) => onFiles([...(e.target.files ?? [])])} aria-hidden="true" tabIndex={-1} />
      <input ref={media} type="file" multiple hidden accept="image/*,video/*" onChange={(e) => onFiles([...(e.target.files ?? [])])} aria-hidden="true" tabIndex={-1} />
    </span>
  );
}

function recorderMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const t of ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']) {
    if (MediaRecorder.isTypeSupported?.(t)) return t;
  }
  return '';
}

/**
 * Nota de voz como en WhatsApp Web: graba al tocar el micrófono, muestra el
 * tiempo, la papelera descarta y la flecha manda. Salir del chat descarta.
 */
export function VoiceBar({ threadId, replyTo, onQueued, onError, onDone, onStart }: { threadId: string; replyTo?: string; /** La nota ya está en el chat (con el reloj): la grabadora se cierra y el envío sigue por detrás. */ onQueued: () => void; onError: (code: string) => void; onDone: () => void; onStart?: () => void }) {
  const w = useTranslations('inboxWa');
  const [secs, setSecs] = useState(0);
  const rec = useRef<{ rec: MediaRecorder; chunks: Blob[]; stream: MediaStream; started: number; send: boolean } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        onError('mic_denied');
        onDone();
        return;
      }
      if (!alive) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const mime = recorderMime();
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const state = { rec: r, chunks: [] as Blob[], stream, started: Date.now(), send: false };
      r.ondataavailable = (e) => e.data.size && state.chunks.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (!state.send || !state.chunks.length) {
          onDone();
          return;
        }
        const type = (r.mimeType || mime || 'audio/webm').split(';')[0];
        const blob = new Blob(state.chunks, { type });
        const seconds = Math.max(1, Math.round((Date.now() - state.started) / 1000));
        // La nota aparece ya en el chat, con el reloj y lista para escuchar; la grabadora se cierra y el envío sigue solo.
        sendInboxMedia({ threadId, file: blob, name: `voice.${type === 'audio/mp4' ? 'm4a' : type === 'audio/ogg' ? 'ogg' : 'webm'}`, kind: 'voice', duration: seconds, replyTo, onError });
        onQueued();
        onDone();
      };
      rec.current = state;
      r.start(250);
      onStart?.();
    })();
    const id = window.setInterval(() => {
      if (!rec.current) return;
      setSecs(Math.floor((Date.now() - rec.current.started) / 1000));
      // "grabando" sigue mientras dure (quien lo recibe limita la frecuencia).
      onStart?.();
    }, 250);
    return () => {
      alive = false;
      window.clearInterval(id);
      const r = rec.current;
      if (r && r.rec.state !== 'inactive') r.rec.stop();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const stop = (send: boolean) => {
    const r = rec.current;
    if (!r) {
      onDone();
      return;
    }
    r.send = send;
    if (r.rec.state !== 'inactive') r.rec.stop();
  };

  return (
    <div className="wa-bar wa-recording" role="group" aria-label={w('recordVoice')}>
      <button type="button" className="wa-icon-btn" onClick={() => stop(false)} aria-label={w('discardVoice')} title={w('discardVoice')}>
        <Trash size={22} />
      </button>
      <span className="wa-rec-dot" aria-hidden="true" />
      <span className="wa-rec-time" aria-live="off">
        {duration(secs)}
      </span>
      <span className="sr-only">{w('recording')}</span>
      <LiveWaveform stream={rec.current?.stream} />
      <button type="button" className="wa-send" onClick={() => stop(true)} aria-label={w('sendVoice')} title={w('sendVoice')}>
        <SendIcon size={20} />
      </button>
    </div>
  );
}
