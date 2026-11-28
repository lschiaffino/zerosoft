'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { composeErrorKey } from '@/lib/ai-compose';
import type { ChatInsights, ChatProposal, InsightRange, ProposalKind } from '@/lib/wa-insights';
import ChatAiAsk, { type AskResult } from './ChatAiAsk';
import ChatAiProposals, { type CreateResult } from './ChatAiProposals';
import { requestComposeInsert } from '@/components/ai/compose-insert';
import { Sparkle } from './icons';

type AiState = 'ready' | 'off' | 'not_configured';
type RangeKey = 'unread' | '1' | '7' | '30';
type Result = { key: RangeKey; insights: ChatInsights; canCreate: boolean; seq: number };
let resultSeq = 0;

/**
 * El último resultado de cada chat, solo en la memoria de esta pestaña del navegador (no se guarda en ningún lado):
 * cerrar y volver a abrir el panel (en el teléfono se cierra al insertar) no obliga a pedirlo de nuevo.
 */
const lastResult = new Map<string, Result>();

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
 * insertan en el campo (nunca se mandan), el ánimo del contacto y seguimientos propuestos que se crean solo al
 * aprobarlos (ChatAiProposals). Abajo, preguntarle a la IA sobre el chat (ChatAiAsk). Se pide con un clic (no gasta IA al abrir la
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
  unreadFrom,
  sectionClass,
  titleClass,
  onInserted,
  before,
  askChat,
  kinds,
  where,
  createProposal,
}: {
  chatKey: string;
  stateUrl: string;
  /** `canCreate` false: los seguimientos propuestos se ven pero no se ofrecen crear (Inbox sin el CRM). */
  run: (range: InsightRange) => Promise<{ ok: true; insights: ChatInsights; canCreate?: boolean } | { ok: false; code: string }>;
  /** Preguntarle a la IA sobre el chat. */
  askChat: (question: string) => Promise<AskResult>;
  /** Qué se puede crear de un seguimiento propuesto (tarea, y ticket en Lines). */
  kinds: readonly ProposalKind[];
  /** Dónde van los seguimientos que se crean (una línea de ayuda). */
  where: string;
  /** Crea un seguimiento que la persona aprobó (nada se crea sin esto). */
  createProposal: (p: ChatProposal) => Promise<CreateResult>;
  unread: number;
  /** El primer mensaje sin leer al abrir el chat (si se sabe): lo que llega después no corre la ventana. */
  unreadFrom?: string;
  sectionClass: string;
  titleClass: string;
  onInserted?: () => void;
  /** Lo que la app pone arriba con IA (Inbox: el resumen de la relación, guardado). Sin IA no se muestra. */
  before?: ReactNode;
}) {
  const t = useTranslations('groups.wa.details.ai');
  const te = useTranslations('common.aiCompose.errors');
  const uid = useId();
  const [ai, setAi] = useState<AiState | null>(null);
  const [result, setResult] = useState<Result | null>(() => lastResult.get(chatKey) ?? null);
  const [range, setRange] = useState<RangeKey>(() => result?.key ?? (unread > 0 ? 'unread' : '7'));
  const [busy, setBusy] = useState(false);
  // Dos clics en el mismo cuadro no piden dos veces (el estado todavía no cambió): la marca va en un ref.
  const running = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [inserted, setInserted] = useState<{ i: number; ok: boolean } | null>(null);

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
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    setInserted(null);
    const key = range;
    const res = await run(key === 'unread' ? { kind: 'unread', unread, ...(unreadFrom ? { from: unreadFrom } : {}) } : { kind: 'days', days: Number(key) as 1 | 7 | 30 });
    running.current = false;
    setBusy(false);
    if (res.ok) {
      const r = { key, insights: res.insights, canCreate: res.canCreate !== false, seq: ++resultSeq };
      lastResult.set(chatKey, r);
      setResult(r);
      return;
    }
    if (res.code === 'ai_disabled') setAi('off');
    else if (res.code === 'ai_not_configured') setAi('not_configured');
    else setError(res.code);
  }, [chatKey, range, run, unread, unreadFrom]);

  const ranges: Array<{ key: RangeKey; label: string; disabled?: boolean; title?: string }> = [
    { key: 'unread', label: unread > 0 ? t('unreadCount', { n: unread }) : t('unread'), disabled: unread <= 0, title: unread > 0 ? undefined : t('unreadNone') },
    { key: '1', label: t('day') },
    { key: '7', label: t('week') },
    { key: '30', label: t('month') },
  ];
  const rangeName = (key: RangeKey) => t(`rangeNames.${key === 'unread' ? 'unread' : key === '1' ? 'day' : key === '7' ? 'week' : 'month'}`);
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
            <div className="wa-ai-range" role="group" aria-label={t('rangeLabel')} data-testid="details-ai-range">
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
              {/* aria-disabled mientras trabaja (no disabled): el foco del teclado no se pierde. */}
              <button type="button" className="btn btn-secondary btn-sm" data-testid="details-ai-run" onClick={() => void ask()} aria-disabled={busy || undefined} aria-busy={busy || undefined}>
                {busy ? t('working') : insights && result?.key === range ? t('again') : t('run')}
              </button>
            </div>
            <p className="ui-help wa-ai-privacy">{t('privacy')}</p>
          </>
        )}
      </section>

      {/* Lo que cambia, para el lector de pantalla (siempre montado, así se anuncia). */}
      <p className="sr-only" role="status" aria-live="polite">
        {busy ? t('working') : insights ? t('basedOn', { n: insights.messages }) : ''}
      </p>

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
        <div className="wa-ai-results" data-testid="details-ai-results" data-range={result?.key}>
          <section className={sectionClass}>
            <h3 className={titleClass}>{t('summary')}</h3>
            <p className="wa-ai-text" dir="auto" data-testid="details-ai-summary">
              {insights.summary}
            </p>
            <p className="ui-help" data-testid="details-ai-based-on">
              {t('basedOnRange', { n: insights.messages, range: rangeName(result!.key) })}
            </p>
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
                    <span className="wa-ai-who">{c.who === 'us' ? t('us') : t('them')}:</span> {c.text}
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
                    <p dir="auto" id={`${uid}-reply-${i}`}>
                      {r}
                    </p>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      data-testid="details-ai-insert"
                      aria-describedby={`${uid}-reply-${i}`}
                      onClick={() => {
                        const ok = requestComposeInsert(chatKey, r);
                        setInserted({ i, ok });
                        if (ok) onInserted?.();
                      }}
                    >
                      {inserted?.i === i && inserted.ok ? t('insertedShort') : t('insert')}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ui-help">{t('none')}</p>
            )}
            {inserted && !inserted.ok ? (
              <p className="ui-help wa-ai-error" role="alert" data-testid="details-ai-insert-failed">
                {t('insertFailed')}
              </p>
            ) : (
              <p className="ui-help">{t('insertHint')}</p>
            )}
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

          <ChatAiProposals
            key={result!.seq}
            chatKey={chatKey}
            seq={result!.seq}
            proposals={insights.proposals ?? []}
            kinds={kinds}
            canCreate={result!.canCreate}
            where={where}
            create={createProposal}
            sectionClass={sectionClass}
            titleClass={titleClass}
          />
        </div>
      )}

      {ai === 'ready' && (
        <ChatAiAsk chatKey={chatKey} ask={askChat} onAiOff={(code) => setAi(code === 'ai_disabled' ? 'off' : 'not_configured')} sectionClass={sectionClass} titleClass={titleClass} />
      )}
    </div>
  );
}
