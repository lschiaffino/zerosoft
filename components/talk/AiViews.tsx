'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { TalkAnswer, TalkSummary } from '@/lib/talk-ai';
import { errorText } from './Composer';
import { Modal } from './Dialogs';
import { fmtFull } from './Message';
import MessageBody from './MessageBody';
import { ViewShell } from './Views';
import { useTalk } from './talk-context';

/** Texto de la IA: viñetas "- " y títulos "#canal" como el formato de Talk. */
function AiText({ text }: { text: string }) {
  return (
    <div className="talk-ai-text">
      {/* Encabezados "## #canal" del modelo → línea en negrita (el formato de Talk no tiene títulos). */}
      <MessageBody body={text.replace(/^#{1,6}\s+(.+)$/gm, '*$1*')} />
    </div>
  );
}

function AiNote() {
  const t = useTranslations('talk');
  return <p className="talk-hint">{t('ai.note')}</p>;
}

/** Resumen de un canal (con rango) o de un hilo. */
export function SummaryDialog({ channelId, rootId, onClose }: { channelId?: string; rootId?: string; onClose: () => void }) {
  const t = useTranslations('talk');
  const ctx = useTalk();
  const [range, setRange] = useState<'unread' | 'day' | 'week'>('unread');
  const [summary, setSummary] = useState<TalkSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kind = rootId ? 'thread' : 'channel';
  const ref = rootId ?? channelId ?? '';

  useEffect(() => {
    void ctx
      .api<{ summary: TalkSummary | null }>(`/api/talk/ai?kind=${kind}&ref=${encodeURIComponent(ref)}`)
      .then((r) => setSummary(r.summary))
      .catch(() => undefined);
  }, [kind, ref]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const r = await ctx.api<{ summary: TalkSummary }>('/api/talk/ai', { method: 'POST', json: rootId ? { kind: 'thread', rootId } : { kind: 'channel', channelId, range } });
      setSummary(r.summary);
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  }

  const channel = channelId ? ctx.channelById.get(channelId) : null;
  const title = rootId ? t('ai.threadTitle') : t('ai.channelTitle', { name: channel ? (channel.kind === 'public' || channel.kind === 'private' ? `#${channel.name}` : ctx.channelTitle(channel)) : '' });
  return (
    <Modal
      title={title}
      onClose={onClose}
      wide
      foot={
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void run()} disabled={busy} aria-busy={busy || undefined} data-testid="talk-ai-run">
          {busy ? t('ai.working') : summary ? t('ai.again') : t('ai.summarize')}
        </button>
      }
    >
      <div className="ui-fields">
        {!rootId && (
          <label className="ui-field">
            <span className="label">{t('ai.range')}</span>
            <select className="select" value={range} onChange={(e) => setRange(e.target.value as typeof range)}>
              <option value="unread">{t('ai.range_unread')}</option>
              <option value="day">{t('ai.range_day')}</option>
              <option value="week">{t('ai.range_week')}</option>
            </select>
          </label>
        )}
        {error && (
          <p className="ui-help talk-ai-error" role="alert">
            {error}
          </p>
        )}
        {busy && !summary && (
          <div className="ui-loading-stack" aria-busy="true" aria-label={t('ai.working')}>
            <div className="ui-skeleton ui-skeleton-row" />
            <div className="ui-skeleton ui-skeleton-row" />
          </div>
        )}
        {summary ? (
          <div className="talk-ai-result" data-testid="talk-ai-summary">
            <p className="talk-muted">{t('ai.basedOn', { count: summary.count, when: fmtFull(summary.createdAt, ctx.locale) })}</p>
            <AiText text={summary.text} />
          </div>
        ) : (
          !busy && !error && <p className="talk-muted">{rootId ? t('ai.threadIntro') : t('ai.channelIntro')}</p>
        )}
        <AiNote />
      </div>
    </Modal>
  );
}

export function TranslateDialog({ messageId, onClose }: { messageId: string; onClose: () => void }) {
  const t = useTranslations('talk');
  const ctx = useTalk();
  const [lang, setLang] = useState(ctx.locale === 'es' || ctx.locale === 'pt' ? ctx.locale : 'en');
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    setError(null);
    try {
      const r = await ctx.api<{ text: string }>('/api/talk/ai', { method: 'POST', json: { kind: 'translate', messageId, lang } });
      setText(r.text);
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={t('ai.translateTitle')}
      onClose={onClose}
      foot={
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void run()} disabled={busy} aria-busy={busy || undefined}>
          {busy ? t('ai.working') : t('ai.translate')}
        </button>
      }
    >
      <div className="ui-fields">
        <label className="ui-field">
          <span className="label">{t('ai.translateTo')}</span>
          <select className="select" value={lang} onChange={(e) => setLang(e.target.value)}>
            {(['en', 'es', 'pt', 'fr', 'de', 'it', 'ja', 'zh'] as const).map((l) => (
              <option key={l} value={l}>
                {t(`ai.lang_${l}`)}
              </option>
            ))}
          </select>
        </label>
        {error && (
          <p className="ui-help talk-ai-error" role="alert">
            {error}
          </p>
        )}
        {text && (
          <div className="talk-ai-result">
            <MessageBody body={text} />
          </div>
        )}
        <AiNote />
      </div>
    </Modal>
  );
}

/** Preguntarle a Talk (en la búsqueda): responde con lo que la persona puede leer y cita las fuentes. */
export function AskPanel({ question }: { question: string }) {
  const t = useTranslations('talk');
  const ctx = useTalk();
  const [answer, setAnswer] = useState<TalkAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setAnswer(null);
    setError(null);
  }, [question]);
  async function run() {
    setBusy(true);
    setError(null);
    try {
      const r = await ctx.api<{ answer: TalkAnswer }>('/api/talk/ai', { method: 'POST', json: { kind: 'ask', question } });
      setAnswer(r.answer);
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="talk-ask" aria-label={t('ai.askTitle')}>
      {!answer && (
        <button type="button" className="btn btn-sm" onClick={() => void run()} disabled={busy} aria-busy={busy || undefined} data-testid="talk-ask">
          {busy ? t('ai.working') : t('ai.ask', { q: question.slice(0, 60) })}
        </button>
      )}
      {error && (
        <p className="ui-help talk-ai-error" role="alert">
          {error}
        </p>
      )}
      {answer && (
        <div className="talk-ai-result" data-testid="talk-ask-answer">
          <h2 className="talk-view-h">{t('ai.askTitle')}</h2>
          {answer.answered ? <AiText text={answer.text} /> : <p className="talk-muted">{t('ai.noAnswer')}</p>}
          {answer.sources.length > 0 && (
            <ol className="talk-ai-sources">
              {answer.sources.slice(0, 10).map((s) => (
                <li key={s.messageId}>
                  <button type="button" className="talk-ai-source" onClick={() => ctx.open({ channelId: s.channelId, messageId: s.parentId ? s.messageId : s.messageId, threadId: s.parentId })}>
                    <span className="talk-muted">
                      [{s.n}] {s.channelKind === 'public' || s.channelKind === 'private' ? `#${s.channelName}` : t('ai.dm')} · {ctx.personName(s.userId)}
                    </span>
                    <span>{s.excerpt}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
          <AiNote />
        </div>
      )}
    </section>
  );
}

/** Recap: lo del día en los canales elegidos (o los míos con actividad). */
export function RecapView({ onBack }: { onBack: () => void }) {
  const t = useTranslations('talk');
  const ctx = useTalk();
  const [summary, setSummary] = useState<TalkSummary | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<string[]>(ctx.boot.prefs.recapChannels ?? []);
  useEffect(() => {
    void ctx
      .api<{ summary: TalkSummary | null }>('/api/talk/ai?kind=recap')
      .then((r) => setSummary(r.summary))
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function run() {
    setBusy(true);
    setError(null);
    try {
      const r = await ctx.api<{ summary: TalkSummary }>('/api/talk/ai', { method: 'POST', json: { kind: 'recap' } });
      setSummary(r.summary);
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  }
  async function savePicked() {
    try {
      await ctx.api('/api/talk/me', { method: 'PATCH', json: { prefs: { recapChannels: picked } } });
      ctx.refreshBoot();
      setPicking(false);
      ctx.toast(t('dialogs.saved'));
    } catch (err) {
      ctx.toast(errorText(t, err), 'error');
    }
  }
  const chans = ctx.channels.filter((c) => c.kind === 'public' || c.kind === 'private');
  const stale = summary && Date.now() - new Date(summary.createdAt).getTime() > 12 * 3_600_000;
  return (
    <ViewShell
      title={t('recap.title')}
      desc={t('recap.desc')}
      onBack={onBack}
      actions={
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicking(true)}>
          {t('recap.channels')}
        </button>
      }
    >
      <div className="talk-recap">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void run()} disabled={busy} aria-busy={busy || undefined} data-testid="talk-recap-run">
          {busy ? t('ai.working') : summary ? t('recap.refresh') : t('recap.make')}
        </button>
        {error && (
          <p className="ui-help talk-ai-error" role="alert">
            {error}
          </p>
        )}
        {!loaded ? null : summary ? (
          <div className="talk-ai-result" data-testid="talk-recap">
            <p className="talk-muted">
              {t('recap.made', { when: fmtFull(summary.createdAt, ctx.locale), count: summary.count })}
              {stale ? ` · ${t('recap.stale')}` : ''}
            </p>
            <AiText text={summary.text} />
            <ul className="talk-recap-sources">
              {summary.sources.map((s) => (
                <li key={s.channelId}>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => ctx.open({ channelId: s.channelId })}>
                    #{s.name} · {t('recap.messages', { count: s.count })}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="ui-empty talk-empty">
            <p className="ui-empty-title">{t('recap.emptyTitle')}</p>
            <p className="ui-empty-body">{t('recap.emptyBody')}</p>
          </div>
        )}
        <AiNote />
      </div>
      {picking && (
        <Modal
          title={t('recap.channels')}
          onClose={() => setPicking(false)}
          foot={
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void savePicked()}>
              {t('common.save')}
            </button>
          }
        >
          <p className="talk-muted">{t('recap.channelsHelp')}</p>
          <ul className="talk-picker-list">
            {chans.map((c) => (
              <li key={c.id}>
                <label className="talk-picker-item">
                  <input type="checkbox" checked={picked.includes(c.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id)))} />
                  <span>
                    {c.kind === 'private' ? '🔒' : '#'}
                    {c.name}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </ViewShell>
  );
}
