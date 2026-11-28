'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { composeErrorKey } from '@/lib/ai-compose';
import type { ChatAnswer } from '@/lib/wa-insights';

export type AskResult = { ok: true; answer: ChatAnswer } | { ok: false; code: string };

const SUGGESTIONS = ['summary', 'asked', 'pending'] as const;

type Answer = { id: number; question: string; answer: string; messages: number };

/**
 * Las últimas respuestas de cada chat y los chats con una pregunta en curso, solo en la memoria de esta pestaña del
 * navegador (no se guardan): cerrar y abrir el panel a mitad de una pregunta no la pierde ni deja mandar otra.
 */
const lastAnswers = new Map<string, Answer[]>();
const asking = new Set<string>();
let answerSeq = 0;
// Cada panel abierto se entera cuando cambia la memoria (una respuesta que llega después de cerrar y abrir).
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());

/**
 * Preguntarle a la IA sobre el chat (pestaña IA, Lines e Inbox): un campo (Enter pregunta, Shift+Enter otra línea),
 * tres preguntas sugeridas y las últimas cinco respuestas con cuántos mensajes leyó. La IA lee solo los últimos
 * mensajes que quien mira ve y responde solo con eso; nada se guarda ni se manda.
 */
export default function ChatAiAsk({
  chatKey,
  ask,
  onAiOff,
  sectionClass,
  titleClass,
}: {
  chatKey: string;
  ask: (question: string) => Promise<AskResult>;
  /** La IA se apagó (o no está configurada) mientras la pestaña estaba abierta: la pestaña entera lo dice. */
  onAiOff: (code: 'ai_disabled' | 'ai_not_configured') => void;
  sectionClass: string;
  titleClass: string;
}) {
  const t = useTranslations('groups.wa.details.ai');
  const te = useTranslations('common.aiCompose.errors');
  const [question, setQuestion] = useState('');
  const [answers, setAnswers] = useState(() => lastAnswers.get(chatKey) ?? []);
  const [busy, setBusy] = useState(() => asking.has(chatKey));
  const [error, setError] = useState('');
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    const sync = () => {
      setAnswers(lastAnswers.get(chatKey) ?? []);
      setBusy(asking.has(chatKey));
    };
    // El estado inicial ya sale de la memoria (la pestaña se arma de nuevo con cada chat).
    subs.add(sync);
    return () => {
      live.current = false;
      subs.delete(sync);
    };
  }, [chatKey]);

  const runAsk = async (q: string, typed: boolean) => {
    const clean = q.trim();
    if (!clean || asking.has(chatKey)) return;
    asking.add(chatKey);
    notify();
    setError('');
    let r: AskResult;
    try {
      r = await ask(clean);
    } catch {
      r = { ok: false, code: 'network' };
    } finally {
      asking.delete(chatKey);
    }
    if (r.ok) {
      // Sobre lo que haya en la memoria en este momento (no sobre lo que había al preguntar).
      const next = [...(lastAnswers.get(chatKey) ?? []), { id: ++answerSeq, question: clean, answer: r.answer.answer, messages: r.answer.messages }].slice(-5);
      lastAnswers.set(chatKey, next);
      // Una sugerida no borra lo que la persona estaba escribiendo.
      if (typed && live.current) setQuestion((cur) => (cur.trim() === clean ? '' : cur));
    } else if (live.current) {
      if (r.code === 'ai_disabled' || r.code === 'ai_not_configured') onAiOff(r.code);
      else setError(r.code === 'no_messages' ? t('askNoMessages') : te(composeErrorKey(r.code)));
    }
    notify();
  };

  return (
    <section className={`${sectionClass} wa-ai-ask`} aria-busy={busy || undefined} data-testid="details-ai-ask">
      <h3 className={titleClass}>{t('askTitle')}</h3>
      <form
        className="wa-ai-form"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void runAsk(question, true);
        }}
      >
        <textarea
          className="input wa-ai-input"
          data-testid="details-ai-question"
          rows={2}
          maxLength={500}
          value={question}
          placeholder={t('askPlaceholder')}
          aria-label={t('askLabel')}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            // Enter pregunta; Shift+Enter, otra línea.
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void runAsk(question, true);
            }
          }}
        />
        <button type="submit" className="btn btn-secondary btn-sm" data-testid="details-ai-ask-go" aria-disabled={!question.trim() || busy || undefined} aria-busy={busy || undefined}>
          {busy ? t('asking') : t('ask')}
        </button>
      </form>
      <div className="wa-ai-suggest" role="group" aria-label={t('suggestionsLabel')}>
        {SUGGESTIONS.map((k) => (
          <button key={k} type="button" className="btn btn-ghost btn-sm" data-testid={`details-ai-suggest-${k}`} aria-disabled={busy || undefined} onClick={() => void runAsk(t(`suggest.${k}`), false)}>
            {t(`suggest.${k}`)}
          </button>
        ))}
      </div>
      {error && (
        <p className="ui-help wa-ai-error" role="alert" data-testid="details-ai-ask-error">
          {error}
        </p>
      )}
      {answers.length > 0 && (
        <ol className="wa-ai-answers">
          {answers.map((a) => (
            <li key={a.id} className="wa-ai-answer" data-testid="details-ai-answer">
              <p className="wa-ai-q" dir="auto">
                {a.question}
              </p>
              <p className="wa-ai-text" dir="auto">
                {a.answer}
              </p>
              <p className="ui-help">{t('basedOn', { n: a.messages })}</p>
            </li>
          ))}
        </ol>
      )}
      <p className="ui-help">{t('askHint')}</p>
    </section>
  );
}
