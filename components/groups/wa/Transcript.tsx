'use client';

import { useEffect, useState } from 'react';
import { toParagraphs } from '@/lib/paragraphs';

export interface TranscriptData {
  status: 'pending' | 'done' | 'failed';
  text: string;
  summary: string;
  error?: string;
}

export interface TranscriptLabels {
  working: string;
  failed: string;
  more: string;
  less: string;
  summary: string;
  title: string;
}

/**
 * Transcripción de un audio debajo de la burbuja (Inbox y Lines): se pide
 * sola la primera vez que se ve el audio (`endpoint`: GET lee lo guardado,
 * POST transcribe), se muestra plegada en tres líneas y, si es largo, con
 * su resumen arriba. Solo la ve quien la pidió (lo controla la ruta).
 */
export default function Transcript({ endpoint, labels, auto = true, retryKey = 0 }: { endpoint: string; labels: TranscriptLabels; auto?: boolean; /** Cambia cuando el audio se volvió a bajar: se transcribe de nuevo si había fallado por eso. */ retryKey?: number }) {
  const [data, setData] = useState<TranscriptData | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null);
    setOpen(false);
    (async () => {
      const r = await fetch(endpoint).catch(() => null);
      const saved = r?.ok ? ((await r.json()) as { transcript: TranscriptData | null }).transcript : null;
      if (!alive) return;
      // Falló porque el audio no se pudo bajar: se vuelve a pedir (el servidor decide si ya toca).
      const again = saved?.status === 'failed' && saved.error === 'media_unavailable';
      if (saved && saved.status !== 'pending' && !again) {
        setData(saved);
        return;
      }
      if (!auto) return;
      // Sin el cartel de "transcribiendo" cuando es un reintento callado de un audio que no estaba.
      setBusy(!again || retryKey > 0);
      const p = await fetch(`${endpoint}${retryKey > 0 ? `${endpoint.includes('?') ? '&' : '?'}force=1` : ''}`, { method: 'POST' }).catch(() => null);
      const made = p?.ok ? ((await p.json()) as { transcript: TranscriptData | null }).transcript : null;
      if (!alive) return;
      setBusy(false);
      setData(made ?? { status: 'failed', text: '', summary: '' });
    })();
    return () => {
      alive = false;
    };
  }, [endpoint, auto, retryKey]);

  if (busy) return <p className="wa-transcript is-busy">{labels.working}</p>;
  if (!data) return null;
  if (data.status === 'failed' || (data.status === 'done' && !data.text)) {
    // Sin audio no hay qué transcribir: el aviso ya está en la burbuja del audio.
    return data.error && /disabled|media_unavailable/.test(data.error) ? null : <p className="wa-transcript is-off">{labels.failed}</p>;
  }
  if (data.status !== 'done') return null;
  const long = data.text.length > 180;
  return (
    <div className="wa-transcript" aria-label={labels.title}>
      {data.summary && (
        <p className="wa-transcript-summary">
          <b>{labels.summary}</b> {data.summary}
        </p>
      )}
      {long && !open ? (
        <p className="wa-transcript-text is-clamped" dir="auto">
          {data.text}
        </p>
      ) : (
        // Entera, en párrafos: más fácil de leer que un bloque corrido.
        <div className="wa-transcript-text" dir="auto">
          {toParagraphs(data.text).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      )}
      {long && (
        <button type="button" className="wa-transcript-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? labels.less : labels.more}
        </button>
      )}
    </div>
  );
}
