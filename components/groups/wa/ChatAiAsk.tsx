'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { composeErrorKey } from '@/lib/ai-compose';
import type { ChatAnswer } from '@/lib/wa-insights';

export type AskResult = { ok: true; answer: ChatAnswer } | { ok: false; code: string };

const SUGGESTIONS = ['summary', 'asked', 'pending'] as const;

/** Las últimas respuestas de cada chat, solo en la memoria de esta pestaña del navegador (no se guardan). */
const lastAnswers = new Map<string, Array<{ id: number; question: string; answer: string; messages: number }>>();

/**
 * Preguntarle a la IA sobre el chat (pestaña IA, Lines e Inbox): un campo (Enter pregunta, Shift+Enter otra línea),
 * tres preguntas sugeridas y las últimas cinco respuestas con cuántos mensajes leyó. La IA lee solo los últimos
 * mensajes que quien mira ve y responde solo con eso; nada se guarda ni se manda.
 */
export default function ChatAiAsk({ chatKey, ask, sectionClass, titleClass }: { chatKey: string; ask: (question: string) => Promise<AskResult>; sectionClass: string; titleClass: string }) {
  const t = useTranslations('groups.wa.details.ai');
  const te = useTranslations('common.aiCompose.errors');
  const [question, setQuestion] = useState('');
  const [answers, setAnswers] = useState(() => lastAnswers.get(chatKey) ?? []);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState('');
  const running = useRef(false);
  const seq = useRef(answers.length ? answers[answers.length - 1].id : 0);

  const runAsk = async (q: string) => {
    const clean = q.trim();
    if (!clean || running.current) return;
    running.current = true;
    setAsking(true);
    setError('');
    const r = await ask(clean);
    running.current = false;
    setAsking(false);
    if (!r.ok) {
      setError(r.code === 'no_messages' ? t('askNoMessages') : te(composeErrorKey(r.code)));
      return;
    }
    seq.current += 1;
    const next = [...answers, { id: seq.current, question: clean, answer: r.answer.answer, messages: r.answer.messages }].slice(-5);
    lastAnswers.set(chatKey, next);
    setAnswers(next);
    setQuestion('');
  };

  return (
    <section className={`${sectionClass} wa-ai-ask`} aria-busy={asking || undefined} data-testid="details-ai-ask">
      <h3 className={titleClass}>{t('askTitle')}</h3>
      <form
        className="wa-ai-form"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void runAsk(question);
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
              void runAsk(question);
            }
          }}
        />
        <button type="submit" className="btn btn-secondary btn-sm" data-testid="details-ai-ask-go" aria-disabled={!question.trim() || asking || undefined} aria-busy={asking || undefined}>
          {asking ? t('asking') : t('ask')}
        </button>
      </form>
      <div className="wa-ai-suggest" role="group" aria-label={t('suggestionsLabel')}>
        {SUGGESTIONS.map((k) => (
          <button key={k} type="button" className="btn btn-ghost btn-sm" data-testid={`details-ai-suggest-${k}`} aria-disabled={asking || undefined} onClick={() => void runAsk(t(`suggest.${k}`))}>
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
