'use client';

import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { MessageDto } from '@/lib/inbox/types';
import { measureImage, newFiles, type TrayItem } from '@/components/groups/wa/attachments';
import type { MenuItem } from '@/components/groups/wa/Menu';
import AttachMenu, { type AttachMenuHandle } from '@/components/groups/wa/AttachMenu';
import { ClockIcon, Mic, Pause, SendIcon, Trash } from '@/components/groups/wa/icons';
import { inboxVoicePayload, longEnough, recordedSoFar, recordedType } from '@/components/groups/wa/voice-later';
import { api } from '../api';
import { uploadInboxFile } from '../ScheduleDialog';
import WhenDialog from '../WhenDialog';
import { MEDIA_SEND_TIMEOUT_MS, inboxQueue, pendingSends, tempInboxMedia } from './pending';
import { withTimeout } from '@/lib/conditional-fetch';
import { TEMP_PREFIX, isOffline, localPreviews, mediaKindOf, newClientId, uploadProgress, type UnsentMedia, type UnsentMediaKind } from '@/lib/optimistic-send';
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
      // Sin red los archivos no se encolan (necesitan subirse): quedan en la bandeja y se avisa. Los textos sí.
      if (list.length && isOffline()) {
        onError?.('offline_files');
        return false;
      }
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

  /** Cambia el archivo de un ítem por otro (la foto editada o achicada en la vista previa). */
  const replace = useCallback((key: string, file: File, size?: { width: number; height: number }) => {
    setItems((l) =>
      l.map((x) => {
        if (x.key !== key) return x;
        if (x.preview) URL.revokeObjectURL(x.preview);
        return { ...x, file, name: file.name || x.name, type: file.type || x.type, size: file.size, preview: URL.createObjectURL(file), ...(size ? { width: size.width, height: size.height } : {}) };
      }),
    );
  }, []);

  const setCaption = useCallback((key: string, caption: string) => patch(key, { caption }), []);
  const retry = useCallback((key: string) => patch(key, { status: 'ready', error: undefined }), []);

  useEffect(() => () => itemsRef.current.forEach((it) => it.preview && URL.revokeObjectURL(it.preview)), []);
  useEffect(() => clear(), [threadId, clear]);

  return { items, add, remove, clear, sendAll, setCaption, retry, replace, sending: false };
}

/**
 * "+" del campo, como el menú de adjuntar de WhatsApp (components/groups/wa/AttachMenu.tsx, el mismo de Lines):
 * documento, fotos y videos, cámara, audio, contacto, encuesta y sticker nuevo; abajo, lo del composer.
 */
export const AttachButton = forwardRef<
  AttachMenuHandle,
  {
    onFiles: (files: File[]) => void;
    disabled?: boolean;
    onContact?: () => void;
    onPoll?: () => void;
    onNewSticker?: (file: File) => void;
    /** Lo que el composer suma al menú (escribir con AI, dictar, snippets). */
    extra?: MenuItem[];
  }
>(function AttachButton(props, ref) {
  return <AttachMenu ref={ref} className="ib-wa-attach" {...props} />;
});

function recorderMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const t of ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']) {
    if (MediaRecorder.isTypeSupported?.(t)) return t;
  }
  return '';
}

/**
 * Nota de voz como en WhatsApp Web: graba al tocar el micrófono, muestra el
 * tiempo, la papelera descarta y la flecha manda. Se puede pausar y seguir.
 * El reloj la programa ("Enviar más tarde", como el del campo de texto): la
 * grabación queda en pausa mientras se elige cuándo, y si se cierra el
 * selector (Esc o clic afuera) sigue ahí, en pausa, sin perderse. Salir del
 * chat descarta.
 */
export function VoiceBar({
  threadId,
  replyTo,
  onQueued,
  onScheduled,
  onError,
  onDone,
  onStart,
}: {
  threadId: string;
  replyTo?: string;
  /** La nota ya está en el chat (con el reloj): la grabadora se cierra y el envío sigue por detrás. */
  onQueued: () => void;
  /** La nota quedó programada para esa hora (ya está en la tira de programados). */
  onScheduled: (iso: string) => void;
  onError: (code: string) => void;
  onDone: () => void;
  onStart?: () => void;
}) {
  const w = useTranslations('inboxWa');
  const [secs, setSecs] = useState(0);
  const [paused, setPaused] = useState(false);
  const [when, setWhen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rec = useRef<{ rec: MediaRecorder; chunks: Blob[]; stream: MediaStream; started: number; carried: number; paused: boolean; mime: string; send: boolean } | null>(null);
  // Un mismo intento de programar (doble clic, reintento) no deja dos programados.
  const laterKey = useRef('');

  /** Segundos grabados, sin contar las pausas. */
  const recorded = () => {
    const r = rec.current;
    return r ? r.carried + (r.paused ? 0 : (Date.now() - r.started) / 1000) : 0;
  };

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
      const state = { rec: r, chunks: [] as Blob[], stream, started: Date.now(), carried: 0, paused: false, mime, send: false };
      r.ondataavailable = (e) => e.data.size && state.chunks.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (!state.send || !state.chunks.length) {
          onDone();
          return;
        }
        const type = recordedType(r, mime);
        const blob = new Blob(state.chunks, { type });
        const seconds = Math.max(1, Math.round(state.carried));
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
      const r = rec.current;
      if (!r) return;
      setSecs(Math.floor(r.carried + (r.paused ? 0 : (Date.now() - r.started) / 1000)));
      // "grabando" sigue mientras dure (quien lo recibe limita la frecuencia); en pausa no.
      if (!r.paused) onStart?.();
    }, 250);
    return () => {
      alive = false;
      window.clearInterval(id);
      const r = rec.current;
      if (r && r.rec.state !== 'inactive') r.rec.stop();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pause = () => {
    const r = rec.current;
    if (!r || r.paused || r.rec.state !== 'recording') return;
    r.rec.pause();
    r.carried += (Date.now() - r.started) / 1000;
    r.paused = true;
    setPaused(true);
  };
  const resume = () => {
    const r = rec.current;
    if (!r || !r.paused || r.rec.state !== 'paused') return;
    r.rec.resume();
    r.started = Date.now();
    r.paused = false;
    setPaused(false);
  };

  const stop = (send: boolean) => {
    const r = rec.current;
    if (!r) {
      onDone();
      return;
    }
    if (!r.paused) r.carried += (Date.now() - r.started) / 1000;
    r.paused = true;
    r.send = send;
    if (r.rec.state !== 'inactive') r.rec.stop();
  };

  /** El reloj: la grabación queda en pausa y se elige cuándo sale. Menos de un segundo no se programa. */
  const openLater = () => {
    if (busy || !rec.current) return;
    if (!longEnough(recorded())) {
      onError('voice_too_short');
      return;
    }
    pause();
    laterKey.current = newClientId();
    setWhen(true);
  };

  /** Sube lo grabado y lo programa. Recién cuando quedó programado se cierra la grabadora: si algo falla, la grabación sigue ahí, en pausa. */
  const schedule = async (iso: string) => {
    setWhen(false);
    const r = rec.current;
    if (!r || busy) return;
    setBusy(true);
    try {
      const type = recordedType(r.rec, r.mime);
      const file = await recordedSoFar(r.rec, r.chunks, type);
      if (!file) throw new Error('voice_too_short');
      const media = await uploadInboxFile(file);
      const res = await api('/api/inbox/scheduled', { method: 'POST', json: inboxVoicePayload({ threadId, sendAt: iso, media, seconds: recorded(), replyTo, key: laterKey.current }) });
      if (!res.ok) throw new Error(res.data.error || 'generic');
    } catch (err) {
      setBusy(false);
      onError(err instanceof Error && err.message ? err.message : 'generic');
      return;
    }
    onScheduled(iso);
    stop(false);
  };

  return (
    <div className="wa-bar wa-recording" role="group" aria-label={w('recordVoice')} aria-busy={busy || undefined}>
      <button type="button" className="wa-icon-btn" onClick={() => stop(false)} disabled={busy} aria-label={w('discardVoice')} title={w('discardVoice')}>
        <Trash size={22} />
      </button>
      <span className={`wa-rec-dot${paused ? ' is-paused' : ''}`} aria-hidden="true" />
      <span className="wa-rec-time" aria-live="off">
        {duration(secs)}
      </span>
      <span className="sr-only">{paused ? w('voicePaused') : w('recording')}</span>
      <LiveWaveform stream={rec.current?.stream} paused={paused} />
      <button type="button" className="wa-icon-btn" onClick={paused ? resume : pause} disabled={busy} aria-label={paused ? w('voiceResume') : w('voicePause')} title={paused ? w('voiceResume') : w('voicePause')}>
        {paused ? <Mic size={22} /> : <Pause size={22} />}
      </button>
      <button type="button" className="wa-icon-btn wa-later-btn" data-testid="inbox-voice-later" onClick={openLater} disabled={busy} aria-busy={busy || undefined} aria-label={w('voiceLater')} title={w('voiceLater')}>
        <ClockIcon size={20} />
      </button>
      <button type="button" className="wa-send" onClick={() => stop(true)} disabled={busy} aria-label={w('sendVoice')} title={w('sendVoice')}>
        <SendIcon size={20} />
      </button>
      <WhenDialog kind={when ? 'sendLater' : null} onPick={(iso) => void schedule(iso)} onClose={() => setWhen(false)} />
    </div>
  );
}
