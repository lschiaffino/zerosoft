'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { VOICE_CONTEXTS, type VoiceContext, type VoiceSessionSummary } from '@/lib/voice-types';
import type { DictationStats } from '@/lib/voice';
import { useDictation, type DictationResult } from './useDictation';
import { copyText } from './insert';
import { LevelBars, MicIcon, voiceErrorKey } from './voice-ui';

interface Props {
  initialHistory: VoiceSessionSummary[];
  stats: DictationStats;
  shortcut: string;
  transcription: boolean;
  ai: boolean;
}

/** /app/voice/dictation: dictar, el último resultado, historial y uso (como Wispr Flow). */
export default function DictationPage({ initialHistory, stats, shortcut, transcription, ai }: Props) {
  const t = useTranslations('voice.dictation');
  const tCtx = useTranslations('voice.contexts');
  const tErr = useTranslations('voice.errors');
  const format = useFormatter();
  const dict = useDictation();
  const [context, setContext] = useState<VoiceContext>('other');
  const [history, setHistory] = useState(initialHistory);
  const [last, setLast] = useState<DictationResult | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [deleting, setDeleting] = useState<VoiceSessionSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [words, setWords] = useState(stats.wordsWeek);
  const holding = useRef(false);

  useEffect(() => {
    const onDictated = (e: Event) => {
      const res = (e as CustomEvent<DictationResult>).detail;
      if (!res?.session?.id) return;
      setHistory((h) => [res.session, ...h.filter((s) => s.id !== res.session.id)]);
      setWords((w) => w + (res.session.words || 0));
    };
    window.addEventListener('zs:voice-dictated', onDictated);
    return () => window.removeEventListener('zs:voice-dictated', onDictated);
  }, []);

  async function finish() {
    holding.current = false;
    const res = await dict.stop({ context, sourceApp: '/app/voice/dictation' });
    if (!res) return;
    setLast(res);
    if (res.session.id) {
      setHistory((h) => [res.session, ...h]);
      setWords((w) => w + (res.session.words || 0));
    }
  }

  async function copy(id: string, text: string) {
    if (await copyText(text)) {
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 2000);
    }
  }

  async function saveEdit() {
    if (!editing) return;
    const { id, text } = editing;
    const prev = history;
    setHistory((h) => h.map((s) => (s.id === id ? { ...s, text } : s)));
    setEditing(null);
    const res = await fetch(`/api/voice/sessions/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    }).catch(() => null);
    if (!res?.ok) {
      setHistory(prev);
      setError('generic');
    }
  }

  async function remove() {
    if (!deleting) return;
    const id = deleting.id;
    const res = await fetch(`/api/voice/sessions/${id}`, { method: 'DELETE' }).catch(() => null);
    setDeleting(null);
    if (!res?.ok) {
      setError('generic');
      return;
    }
    setHistory((h) => h.filter((s) => s.id !== id));
  }

  const recording = dict.state === 'recording';
  const busy = dict.state !== 'idle';
  const errCode = dict.error ?? error;

  return (
    <div className="app-page ui-page vc-page">
      <PageHeader title={t('title')} description={t('subtitle', { shortcut })} />

      {!transcription && <p className="vc-notice">{tErr('transcribe_disabled')}</p>}
      {transcription && !ai && <p className="vc-notice">{t('noAi')}</p>}

      <section className="vc-dictate" aria-labelledby="vc-dictate-title">
        <h2 id="vc-dictate-title" className="sr-only">
          {t('title')}
        </h2>
        <div className="vc-dictate-row">
          <button
            type="button"
            className={`btn btn-primary btn-lg vc-dictate-btn${recording ? ' is-recording' : ''}`}
            disabled={!transcription || dict.state === 'transcribing'}
            aria-pressed={recording}
            aria-busy={dict.state === 'transcribing' || undefined}
            onClick={() => {
              if (holding.current) return;
              if (recording) void finish();
              else if (dict.state === 'idle') void dict.start();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && recording) dict.cancel();
            }}
          >
            <MicIcon size={20} />
            {dict.state === 'transcribing' ? t('transcribing') : recording ? t('stop') : t('start')}
          </button>
          {recording && <LevelBars level={dict.level} />}
          {recording && (
            <button type="button" className="btn btn-ghost" onClick={() => dict.cancel()}>
              {t('cancel')}
            </button>
          )}
          <label className="vc-inline-field">
            <span className="label">{t('context')}</span>
            <select className="select" value={context} disabled={busy} onChange={(e) => setContext(e.target.value as VoiceContext)}>
              {VOICE_CONTEXTS.map((c) => (
                <option key={c} value={c}>
                  {tCtx(c)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="vc-muted">{t('hint', { shortcut })}</p>
        {errCode && (
          <p className="ui-error" role="alert">
            {tErr(voiceErrorKey(errCode))}
          </p>
        )}
        {last && (
          <div className="vc-result" data-testid="voice-dictation-result">
            <p className="vc-result-text">{last.text}</p>
            <div className="vc-send-row">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copy('last', last.text)}>
                {copied === 'last' ? t('copied') : t('copy')}
              </button>
              {!last.ai && <span className="vc-muted">{last.aiError ? t('rulesOnly') : t('rulesOff')}</span>}
            </div>
          </div>
        )}
      </section>

      <section className="vc-block" aria-labelledby="vc-try">
        <h2 id="vc-try" className="ui-section-title">
          {t('tryTitle')}
        </h2>
        <textarea className="textarea" rows={4} placeholder={t('tryPlaceholder', { shortcut })} aria-label={t('tryTitle')} data-voice-context={context} />
      </section>

      <section className="vc-block" aria-labelledby="vc-stats">
        <h2 id="vc-stats" className="ui-section-title">
          {t('statsTitle')}
        </h2>
        <dl className="vc-stats">
          <div>
            <dt>{t('statsWordsWeek')}</dt>
            <dd className="num">{format.number(words)}</dd>
          </div>
          <div>
            <dt>{t('statsDictations')}</dt>
            <dd className="num">{format.number(history.length)}</dd>
          </div>
          <div>
            <dt>{t('statsMinutes')}</dt>
            <dd className="num">{format.number(stats.minutesTotal)}</dd>
          </div>
        </dl>
      </section>

      <section className="vc-block" aria-labelledby="vc-history">
        <h2 id="vc-history" className="ui-section-title">
          {t('historyTitle')}
        </h2>
        {history.length === 0 ? (
          <EmptyState compact title={t('emptyTitle')} body={t('emptyBody', { shortcut })} />
        ) : (
          <ul className="vc-list" aria-label={t('historyTitle')}>
            {history.map((s) => (
              <li key={s.id} className="vc-row vc-row-dictation" data-testid="voice-dictation-row">
                {editing?.id === s.id ? (
                  <textarea
                    className="textarea vc-rename"
                    value={editing.text}
                    autoFocus
                    rows={3}
                    aria-label={t('edit')}
                    onChange={(e) => setEditing({ id: s.id, text: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void saveEdit();
                      if (e.key === 'Escape') setEditing(null);
                    }}
                    onBlur={() => void saveEdit()}
                  />
                ) : (
                  <div className="vc-row-main">
                    <span className="vc-row-text">{s.text}</span>
                    <span className="vc-muted vc-row-meta" suppressHydrationWarning>
                      {format.dateTime(new Date(s.startedAt), { dateStyle: 'medium', timeStyle: 'short' })}
                      {s.context && ` · ${tCtx((VOICE_CONTEXTS as readonly string[]).includes(s.context) ? s.context : 'other')}`}
                      {s.capture === 'desktop' && ` · ${t('fromDesktop')}`}
                    </span>
                  </div>
                )}
                <span className="vc-row-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copy(s.id, s.text)}>
                    {copied === s.id ? t('copied') : t('copy')}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing({ id: s.id, text: s.text })}>
                    {t('edit')}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeleting(s)}>
                    {t('delete')}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={!!deleting}
        title={t('deleteTitle')}
        body={t('deleteBody')}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        danger
        onConfirm={() => void remove()}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
