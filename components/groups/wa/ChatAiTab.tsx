'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { composeErrorKey } from '@/lib/ai-compose';
import type { ChatInsights, InsightRange } from '@/lib/wa-insights';
import { requestComposeInsert } from '@/components/ai/compose-insert';
import { Sparkle } from './icons';

type AiState = 'ready' | 'off' | 'not_configured';
type RangeKey = 'unread' | '1' | '7' | '30';

async function getJson<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; data: T & { error?: string } }> {
  try {
    const res = await fetch(url, init);
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    return { ok: res.ok, data };
  } catch {
    return { ok: false, data: { error: 'network' } as T & { error?: string } };
  }
}

/**
 * La pestaña AI del panel de un chat, en Lines y en Inbox (como el resumen de Periskope): un resumen desde la última
 * lectura o de los últimos días, las preguntas sin responder, los compromisos pendientes, respuestas sugeridas que se
 * insertan en el campo (nunca se mandan) y el ánimo del contacto. Se pide con un clic (no gasta IA al abrir la
 * pestaña); solo usa los mensajes que quien mira ve y no guarda nada. Sin IA en el workspace lo dice y no ofrece nada.
 *
 * `stateUrl` responde { ai }, `run` pide las ideas del rango. `unread`: cuántos mensajes había sin leer al abrir el
 * chat ("desde la última lectura"; 0 lo deshabilita). `onInserted`: después de insertar (en el teléfono, cerrar el
 * panel para ver el campo). Las clases de sección y título son las del panel de cada app.
 */
export default function ChatAiTab({
  chatKey,
  stateUrl,
  run,
  unread,
  sectionClass,
  titleClass,
  onInserted,
  before,
}: {
  chatKey: string;
  stateUrl: string;
  run: (range: InsightRange) => Promise<{ ok: true; insights: ChatInsights } | { ok: false; code: string }>;
  unread: number;
  sectionClass: string;
  titleClass: string;
  onInserted?: () => void;
  /** Lo que la app pone arriba con IA (Inbox: el resumen de la relación, guardado). Sin IA no se muestra. */
  before?: ReactNode;
}) {
  const t = useTranslations('groups.wa.details.ai');
  const te = useTranslations('common.aiCompose.errors');
  const [ai, setAi] = useState<AiState | null>(null);
  const [range, setRange] = useState<RangeKey>(unread > 0 ? 'unread' : '7');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ key: RangeKey; insights: ChatInsights } | null>(null);
  const [inserted, setInserted] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    void getJson<{ ai: AiState }>(stateUrl).then((r) => {
      if (!live) return;
      // Sin respuesta (red, chat que ya no está): se deja pedir; el error del pedido lo explica.
      setAi(r.ok ? r.data.ai : 'ready');
    });
    return () => {
      live = false;
    };
  }, [stateUrl]);

  const ask = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setInserted(null);
    const key = range;
    const res = await run(key === 'unread' ? { kind: 'unread', unread } : { kind: 'days', days: Number(key) as 1 | 7 | 30 });
    setBusy(false);
    if (res.ok) {
      setResult({ key, insights: res.insights });
      return;
    }
    if (res.code === 'ai_disabled') setAi('off');
    else if (res.code === 'ai_not_configured') setAi('not_configured');
    else setError(res.code);
  }, [busy, range, run, unread]);

  const ranges: Array<{ key: RangeKey; label: string; disabled?: boolean; title?: string }> = [
    { key: 'unread', label: unread > 0 ? t('unreadCount', { n: unread }) : t('unread'), disabled: unread <= 0, title: unread > 0 ? undefined : t('unreadNone') },
    { key: '1', label: t('day') },
    { key: '7', label: t('week') },
    { key: '30', label: t('month') },
  ];
  const insights = result?.insights ?? null;
  const off = ai === 'off' || ai === 'not_configured';

  return (
    <div className="wa-ai" data-testid="details-ai" data-chat={chatKey}>
      {!off && before}
      <section className={sectionClass}>
        <h3 className={`${titleClass} wa-ai-title`}>
          <Sparkle size={16} /> {t('title')}
        </h3>
        {off ? (
          <p className="ui-help wa-ai-off" role="note" data-testid="details-ai-off">
            {ai === 'off' ? te('off') : te('notConfigured')}
          </p>
        ) : (
          <>
            <div className="wa-ai-range" role="group" aria-label={t('rangeLabel')}>
              {ranges.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  className="wa-ai-range-btn"
                  aria-pressed={range === r.key}
                  disabled={r.disabled || busy}
                  title={r.title}
                  data-range={r.key}
                  onClick={() => setRange(r.key)}
                >
                  {r.label}
                </button>
              ))}
            </div>
            {!unread && <p className="ui-help wa-ai-hint">{t('unreadNone')}</p>}
            <div className="wa-ai-run">
              <button type="button" className="btn btn-secondary btn-sm" data-testid="details-ai-run" onClick={() => void ask()} disabled={busy || ai === null} aria-busy={busy || undefined}>
                {busy ? t('working') : insights && result?.key === range ? t('again') : t('run')}
              </button>
            </div>
            <p className="ui-help wa-ai-privacy">{t('privacy')}</p>
          </>
        )}
      </section>

      {!off && busy && (
        <section className={sectionClass} aria-busy="true" data-testid="details-ai-loading">
          <span className="ui-skeleton ui-skeleton-row" />
          <span className="ui-skeleton ui-skeleton-row" />
          <span className="ui-skeleton ui-skeleton-row" />
        </section>
      )}

      {!off && !busy && error && (
        <section className={sectionClass}>
          <p className="ui-help wa-ai-error" role="alert" data-testid="details-ai-error">
            {error === 'no_messages' ? t('noMessages') : te(composeErrorKey(error))}
          </p>
        </section>
      )}

      {!off && !busy && insights && (
        <div className="wa-ai-results" aria-live="polite" data-testid="details-ai-results">
          <section className={sectionClass}>
            <h3 className={titleClass}>{t('summary')}</h3>
            <p className="wa-ai-text" dir="auto" data-testid="details-ai-summary">
              {insights.summary}
            </p>
            <p className="ui-help">{t('basedOn', { n: insights.messages })}</p>
          </section>

          <section className={sectionClass} data-testid="details-ai-questions">
            <h3 className={titleClass}>{t('questions')}</h3>
            {insights.questions.length ? (
              <ul className="wa-ai-list">
                {insights.questions.map((q, i) => (
                  <li key={i} dir="auto">
                    {q}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ui-help">{t('none')}</p>
            )}
          </section>

          <section className={sectionClass} data-testid="details-ai-commitments">
            <h3 className={titleClass}>{t('commitments')}</h3>
            {insights.commitments.length ? (
              <ul className="wa-ai-list">
                {insights.commitments.map((c, i) => (
                  <li key={i} dir="auto">
                    <span className="wa-ai-who">{c.who === 'us' ? t('us') : t('them')}</span> {c.text}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ui-help">{t('none')}</p>
            )}
          </section>

          <section className={sectionClass} data-testid="details-ai-replies">
            <h3 className={titleClass}>{t('replies')}</h3>
            {insights.replies.length ? (
              <ul className="wa-ai-replies">
                {insights.replies.map((r, i) => (
                  <li key={i} className="wa-ai-reply" data-testid="details-ai-reply">
                    <p dir="auto">{r}</p>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      data-testid="details-ai-insert"
                      onClick={() => {
                        requestComposeInsert(chatKey, r);
                        setInserted(i);
                        onInserted?.();
                      }}
                    >
                      {inserted === i ? t('insertedShort') : t('insert')}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ui-help">{t('none')}</p>
            )}
            <p className="ui-help">{t('insertHint')}</p>
          </section>

          <section className={sectionClass} data-testid="details-ai-mood">
            <h3 className={titleClass}>{t('mood')}</h3>
            <p className="wa-ai-text">
              <span className="wa-ai-mood" data-mood={insights.sentiment}>
                {t(`moods.${insights.sentiment}`)}
              </span>
              {insights.sentimentNote ? <span dir="auto"> · {insights.sentimentNote}</span> : null}
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
