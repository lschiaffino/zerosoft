'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { MessageDto } from '@/lib/inbox/types';
import type { TrayItem } from '@/components/groups/wa/attachments';
import { MessageMenu } from '@/components/groups/wa/Menu';
import { DocIcon, PhotoIcon, Plus, SendIcon, Trash } from '@/components/groups/wa/icons';
import { duration } from '@/components/groups/wa/format';

/** Lo que entra en un pedido (como lib/inbox/wa-media.ts); más grande va directo a Blob. */
const INLINE_MAX = 4 * 1024 * 1024;
const MAX_FILES = 30;
let seq = 0;

type Sent = { messages: MessageDto[] };

/** Manda un archivo: chico por el pedido (con avance), grande por Blob y después la URL. */
async function sendOne(threadId: string, f: { file: Blob; name: string; caption?: string; kind?: string; duration?: number; replyTo?: string }, onProgress: (p: number) => void): Promise<Sent> {
  if (f.file.size <= INLINE_MAX) {
    return new Promise<Sent>((resolve, reject) => {
      const form = new FormData();
      form.append('file', f.file, f.name);
      if (f.caption) form.append('caption', f.caption);
      if (f.kind) form.append('kind', f.kind);
      if (f.duration) form.append('duration', String(f.duration));
      if (f.replyTo) form.append('replyTo', f.replyTo);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/inbox/threads/${threadId}/media`);
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
    });
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
  const res = await fetch(`/api/inbox/threads/${threadId}/media`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url, mimetype: f.file.type, filename: f.name, size: f.file.size, caption: f.caption, kind: f.kind, duration: f.duration, replyTo: f.replyTo }),
  }).catch(() => null);
  const data = ((await res?.json().catch(() => ({}))) ?? {}) as Partial<Sent> & { error?: string };
  if (!res?.ok || !data.messages) throw new Error(data.error || 'send_failed');
  return data as Sent;
}

/**
 * Los archivos elegidos, arrastrados o pegados, antes de mandar (como la
 * vista previa de WhatsApp Web): uno por uno con su comentario, en orden.
 * Lo que falla queda en la bandeja para reintentar o sacar.
 */
export function useSendTray(threadId: string, onSent: (messages: MessageDto[]) => void) {
  const [items, setItems] = useState<TrayItem[]>([]);
  const [sending, setSending] = useState(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const add = useCallback((files: File[]) => {
    const room = MAX_FILES - itemsRef.current.length;
    const next = files.slice(0, Math.max(0, room)).map<TrayItem>((file) => ({
      key: `s${++seq}`,
      file,
      name: file.name || 'file',
      type: file.type || 'application/octet-stream',
      size: file.size,
      preview: /^(image|video)\//.test(file.type) ? URL.createObjectURL(file) : '',
      progress: 0,
      status: 'ready',
    }));
    if (next.length) setItems((l) => [...l, ...next]);
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

  const patch = (key: string, p: Partial<TrayItem>) => setItems((l) => l.map((x) => (x.key === key ? { ...x, ...p } : x)));

  const sendAll = useCallback(
    async (replyTo?: string) => {
      if (sending) return;
      setSending(true);
      let last: MessageDto[] | null = null;
      for (const it of itemsRef.current.filter((x) => x.status !== 'error' || x.error === 'network' || x.error === 'send_failed')) {
        patch(it.key, { status: 'uploading', progress: 0, error: undefined });
        try {
          const r = await sendOne(threadId, { file: it.file, name: it.name, caption: it.caption, replyTo }, (p) => patch(it.key, { progress: p }));
          last = r.messages;
          remove(it.key);
        } catch (err) {
          patch(it.key, { status: 'error', error: (err as Error).message || 'send_failed' });
        }
      }
      setSending(false);
      if (last) onSent(last);
      return itemsRef.current.length === 0;
    },
    [sending, threadId, onSent, remove],
  );

  const setCaption = useCallback((key: string, caption: string) => patch(key, { caption }), []);
  const retry = useCallback((key: string) => patch(key, { status: 'ready', error: undefined }), []);

  useEffect(() => () => itemsRef.current.forEach((it) => it.preview && URL.revokeObjectURL(it.preview)), []);
  useEffect(() => clear(), [threadId, clear]);

  return { items, add, remove, clear, sendAll, setCaption, retry, sending };
}

/** "+" del campo: documento o fotos y videos (como el menú de adjuntar de WhatsApp Web). */
export function AttachButton({ onFiles, disabled }: { onFiles: (files: File[]) => void; disabled?: boolean }) {
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
export function VoiceBar({ threadId, replyTo, onSent, onError, onDone, onStart }: { threadId: string; replyTo?: string; onSent: (m: MessageDto[]) => void; onError: (code: string) => void; onDone: () => void; onStart?: () => void }) {
  const w = useTranslations('inboxWa');
  const [secs, setSecs] = useState(0);
  const [busy, setBusy] = useState(false);
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
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (!state.send || !state.chunks.length) {
          onDone();
          return;
        }
        const type = (r.mimeType || mime || 'audio/webm').split(';')[0];
        const blob = new Blob(state.chunks, { type });
        const seconds = Math.max(1, Math.round((Date.now() - state.started) / 1000));
        setBusy(true);
        try {
          const res = await sendOne(threadId, { file: blob, name: `voice.${type === 'audio/mp4' ? 'm4a' : type === 'audio/ogg' ? 'ogg' : 'webm'}`, kind: 'voice', duration: seconds, replyTo }, () => {});
          onSent(res.messages);
        } catch (err) {
          onError((err as Error).message || 'send_failed');
        }
        setBusy(false);
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
      <button type="button" className="wa-icon-btn" onClick={() => stop(false)} aria-label={w('discardVoice')} title={w('discardVoice')} disabled={busy}>
        <Trash size={22} />
      </button>
      <span className="wa-rec-dot" aria-hidden="true" />
      <span className="wa-rec-time" aria-live="off">
        {duration(secs)}
      </span>
      <span className="wa-rec-label">{busy ? w('sendingVoice') : w('recording')}</span>
      <button type="button" className="wa-send" onClick={() => stop(true)} aria-label={w('sendVoice')} title={w('sendVoice')} disabled={busy}>
        <SendIcon size={20} />
      </button>
    </div>
  );
}
