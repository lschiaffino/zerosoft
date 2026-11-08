'use client';

import { Fragment } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { readEvents } from '@/components/assistant/client';
import { splitCitations, type VoiceCite } from '@/lib/voice-cite';

/** Una reunión que usó la respuesta entre varias (lib/voice-service.ts AcrossSource). */
export interface AnswerSource {
  label: string;
  id: string;
  title: string;
  startedAt: string;
  href: string;
  sharedBy?: string;
}

export type VoiceStreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'meetings'; meetings: AnswerSource[] }
  | { type: 'done'; chat?: unknown }
  | { type: 'error'; code: string };

/**
 * POST con { stream: true } a una ruta de chat de Voice. Devuelve el código de
 * error (o null) y llama `on` con cada evento mientras llegan.
 */
export async function streamVoice(url: string, body: Record<string, unknown>, on: (e: VoiceStreamEvent) => void, signal?: AbortSignal): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, stream: true }), signal });
  } catch {
    return signal?.aborted ? 'aborted' : 'network';
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    return data?.error ?? 'generic';
  }
  let error: string | null = null;
  let done = false;
  try {
    await readEvents<VoiceStreamEvent>(res, (e) => {
      if (e.type === 'error') error = e.code;
      if (e.type === 'done') done = true;
      on(e);
    });
  } catch {
    return signal?.aborted ? 'aborted' : 'network';
  }
  return error ?? (done ? null : 'network');
}

/** Texto de una respuesta con las citas como links: al momento de la transcripción o a la reunión. */
export function CitedText({ text, onSeek, sources }: { text: string; onSeek?: (ms: number) => void; sources?: AnswerSource[] }) {
  const t = useTranslations('voice.chat');
  const locale = useLocale();
  const parts = splitCitations(text);
  const cite = (c: VoiceCite, i: number) => {
    if (c.meeting && sources) {
      const s = sources.find((x) => x.label === c.meeting);
      if (!s) return null;
      const name = s.title || t('untitled');
      const href = c.ms !== null && !s.sharedBy ? `${s.href}?t=${Math.floor(c.ms / 1000)}` : s.href;
      const label = c.time ? t('citeMeetingAt', { title: name, time: c.time }) : t('citeMeeting', { title: name });
      const text = c.time ? `${shortTitle(name)} ${c.time}` : shortTitle(name);
      return s.sharedBy ? (
        <a key={i} className="vc-cite" href={`/${locale}${href}`} aria-label={label} title={label}>
          {text}
        </a>
      ) : (
        <Link key={i} className="vc-cite" href={href} aria-label={label} title={label}>
          {text}
        </Link>
      );
    }
    if (c.ms === null || !c.time) return null;
    if (!onSeek) return <span key={i} className="vc-cite data">{c.time}</span>;
    const label = t('citeAt', { time: c.time });
    return (
      <button key={i} type="button" className="vc-cite data" aria-label={label} title={label} onClick={() => onSeek(c.ms!)}>
        {c.time}
      </button>
    );
  };
  return (
    <>
      {parts.map((p, i) => {
        if (p.kind === 'text') return <Fragment key={i}>{p.text}</Fragment>;
        // Una cita a algo que no está (otra etiqueta, sin transcripción) queda como texto.
        const nodes = p.cites.map(cite);
        return <Fragment key={i}>{nodes.some(Boolean) ? nodes : p.raw}</Fragment>;
      })}
    </>
  );
}

function shortTitle(s: string): string {
  return s.length > 28 ? `${s.slice(0, 27)}…` : s;
}

/** Preguntas sugeridas cuando el chat está vacío (como los de Granola). */
export function Suggestions({ items, onPick, disabled }: { items: string[]; onPick: (q: string) => void; disabled?: boolean }) {
  const t = useTranslations('voice.chat');
  return (
    <div className="vc-suggest">
      <p className="vc-muted vc-suggest-title">{t('suggestionsLabel')}</p>
      <ul>
        {items.map((q) => (
          <li key={q}>
            <button type="button" className="vc-suggest-btn" disabled={disabled} onClick={() => onPick(q)}>
              {q}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
