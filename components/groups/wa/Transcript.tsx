'use client';

import { useEffect, useState } from 'react';

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
export default function Transcript({ endpoint, labels, auto = true }: { endpoint: string; labels: TranscriptLabels; auto?: boolean }) {
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
      if (saved && saved.status !== 'pending') {
        setData(saved);
        return;
      }
      if (!auto) return;
      setBusy(true);
      const p = await fetch(endpoint, { method: 'POST' }).catch(() => null);
      const made = p?.ok ? ((await p.json()) as { transcript: TranscriptData | null }).transcript : null;
      if (!alive) return;
      setBusy(false);
      setData(made ?? { status: 'failed', text: '', summary: '' });
    })();
    return () => {
      alive = false;
    };
  }, [endpoint, auto]);

  if (busy) return <p className="wa-transcript is-busy">{labels.working}</p>;
  if (!data) return null;
  if (data.status === 'failed' || (data.status === 'done' && !data.text)) {
    return data.error && /disabled/.test(data.error) ? null : <p className="wa-transcript is-off">{labels.failed}</p>;
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
      <p className={`wa-transcript-text${long && !open ? ' is-clamped' : ''}`} dir="auto">
        {data.text}
      </p>
      {long && (
        <button type="button" className="wa-transcript-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? labels.less : labels.more}
        </button>
      )}
    </div>
  );
}
