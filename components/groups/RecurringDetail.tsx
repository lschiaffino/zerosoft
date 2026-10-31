'use client';

import { useMounted } from '@/components/ui/useMounted';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { RecurringDto } from '@/lib/groups-recurring';
import type { RecurrenceRule } from '@/lib/groups-recurrence';
import { ChatPlate, api, useErrorText, useToast } from './ui';
import { PollFields, RecurrenceFields, checkRule, endsIso, useRuleText } from './RecurringParts';
import { parseDbUtc } from '@/lib/utils';

interface Run {
  id: string;
  status: string;
  total: number;
  sent: number;
  failed: number;
  scheduledAt: string;
}

/** Editor de un mensaje recurrente (texto o encuesta, regla, zona, fin, nombre), pausa y corridas. */
export default function RecurringDetail({
  initial,
  runs,
  chats,
  numberName,
  pollsOk,
}: {
  initial: RecurringDto;
  runs: Run[];
  chats: Array<{ id: string; name: string; kind: 'dm' | 'group' }>;
  numberName: string;
  pollsOk: boolean;
}) {
  const t = useTranslations('groups');
  const locale = useLocale();
  const mounted = useMounted();
  const router = useRouter();
  const errText = useErrorText();
  const ruleText = useRuleText();
  const [toast, showToast] = useToast();
  const [rec, setRec] = useState(initial);
  const [name, setName] = useState(initial.name);
  const [body, setBody] = useState(initial.body);
  const [poll, setPoll] = useState(initial.poll ?? { question: '', options: ['', ''], multi: false });
  const [rule, setRule] = useState<RecurrenceRule>(initial.rule);
  const [timezone, setTimezone] = useState(initial.timezone);
  const [endsAt, setEndsAt] = useState(initial.endsAt ? parseDbUtc(initial.endsAt).toLocaleDateString('en-CA') : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState(false);
  const isPoll = Boolean(initial.poll);

  async function save() {
    setError('');
    const bad = checkRule(rule);
    if (bad) return setError(errText(bad));
    setBusy(true);
    const res = await api<RecurringDto>(`/api/groups/recurring/${rec.id}`, {
      method: 'PATCH',
      body: {
        name,
        ...(isPoll ? { poll: { ...poll, options: poll.options.map((o) => o.trim()).filter(Boolean) } } : { body }),
        rule,
        timezone,
        endsAt: endsIso(endsAt),
      },
    });
    setBusy(false);
    if (!res.data) return setError(errText(res.error));
    setRec(res.data);
    showToast(t('common.saved'));
    router.refresh();
  }
  async function toggle() {
    const res = await api<RecurringDto>(`/api/groups/recurring/${rec.id}`, { method: 'PATCH', body: { status: rec.status === 'active' ? 'paused' : 'active' } });
    if (res.data) setRec(res.data);
    else showToast(errText(res.error), true);
  }
  async function remove() {
    const res = await api(`/api/groups/recurring/${rec.id}`, { method: 'DELETE' });
    setRemoving(false);
    if (!res.data) return showToast(errText(res.error), true);
    router.push('/app/groups/broadcasts');
  }

  return (
    <div className="gr-composer-page">
      <form
        className="gr-composer-main ui-fields"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className={`gr-banner${rec.status === 'active' ? '' : ' is-bad'}`} role="status">
          <span>
            {rec.status === 'active' && rec.nextRunAt
              ? t('recurring.nextRun', { when: (mounted ? parseDbUtc(rec.nextRunAt).toLocaleString(locale, { dateStyle: 'full', timeStyle: 'short' }) : '') })
              : t(`recurring.status.${rec.status}`)}{' '}
            · {ruleText(rec.rule)}
          </span>
          {rec.status !== 'ended' && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void toggle()}>
              {rec.status === 'active' ? t('recurring.pause') : t('recurring.resume')}
            </button>
          )}
        </div>
        <label className="ui-field">
          <span className="label">{t('broadcasts.name')}</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={t('broadcasts.namePlaceholder')} />
        </label>
        {isPoll ? (
          <>
            {!pollsOk && <p className="gr-banner is-bad">{t('polls.unsupported')}</p>}
            <PollFields question={poll.question} options={poll.options} multi={poll.multi} onChange={setPoll} idPrefix="rec" />
          </>
        ) : (
          <label className="ui-field">
            <span className="label">{t('broadcasts.message')}</span>
            <textarea className="textarea" rows={5} value={body} onChange={(e) => setBody(e.target.value)} maxLength={4096} />
            <span className="ui-help">{t('recurring.varsHelp')}</span>
          </label>
        )}
        <RecurrenceFields rule={rule} onChange={setRule} timezone={timezone} onTimezone={setTimezone} endsAt={endsAt} onEndsAt={setEndsAt} />
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
        <div className="gr-inline-form">
          <button type="submit" className="btn btn-primary" aria-busy={busy || undefined} disabled={busy}>
            {t('common.save')}
          </button>
          <button type="button" className="btn btn-ghost gr-danger" onClick={() => setRemoving(true)}>
            {t('common.delete')}
          </button>
        </div>

        <section className="gr-detail-section" aria-labelledby="gr-runs">
          <h2 className="gr-detail-title" id="gr-runs">
            {t('recurring.runs', { n: rec.runs })}
          </h2>
          {runs.length === 0 ? (
            <p className="ui-help">{t('recurring.noRuns')}</p>
          ) : (
            <ul className="gr-mini-list">
              {runs.map((r) => (
                <li key={r.id}>
                  <span>
                    <Link href={`/app/groups/broadcasts/${r.id}`}>{(mounted ? parseDbUtc(r.scheduledAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) : '')}</Link>
                  </span>
                  <span className="ui-help">
                    {t(`broadcastStatus.${r.status}`)} · {r.sent + r.failed}/{r.total}
                    {r.failed > 0 && <span className="ui-error"> · {t('broadcasts.failedN', { n: r.failed })}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </form>
      <aside className="gr-recipients" aria-label={t('broadcasts.recipients')}>
        <div className="gr-detail-head">
          <h3 className="gr-detail-title">{t('broadcasts.recipientsCount', { n: chats.length })}</h3>
        </div>
        <p className="ui-help">{t('recurring.from', { name: numberName })}</p>
        <ul className="gr-pick-list">
          {chats.map((c) => (
            <li key={c.id}>
              <Link href={`/app/groups/inbox/${c.id}`} className="gr-check-label">
                <ChatPlate name={c.name} kind={c.kind} />
                <span className="gr-pick-name">{c.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      </aside>
      <ConfirmDialog
        open={removing}
        title={t('recurring.deleteTitle', { name: rec.name || rec.body.slice(0, 40) })}
        body={t('recurring.deleteBody')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(false)}
      />
      {toast}
    </div>
  );
}
