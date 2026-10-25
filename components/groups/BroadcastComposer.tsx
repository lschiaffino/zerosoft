'use client';

import { useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import type { ChatDto, LabelDto, NumberDto, PropertyDef } from '@/lib/groups';
import { chatVariables, renderVariables } from '@/lib/groups-rules';
import { ChatPlate, LabelTag, NumberOptions, api, defaultNumberId, useErrorText } from './ui';
import { DEFAULT_RULE, PollFields, RecurrenceFields, browserTimezone, checkRule, endsIso } from './RecurringParts';
import type { RecurrenceRule } from '@/lib/groups-recurrence';

/**
 * Nuevo envío masivo: número de salida, destinatarios (grupos y chats, con
 * filtro por etiqueta y tipo), mensaje con variables, adjunto, hora y ritmo.
 * La vista previa muestra el texto con los datos del primer destinatario.
 */
export default function BroadcastComposer({
  numbers,
  chats,
  labels,
  properties,
  preselected,
  initialWhen = 'now',
}: {
  numbers: NumberDto[];
  chats: ChatDto[];
  labels: LabelDto[];
  properties: PropertyDef[];
  preselected: string[];
  initialWhen?: 'now' | 'later' | 'repeat';
}) {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const router = useRouter();
  const firstNumber = defaultNumberId(numbers, chats.find((c) => preselected.includes(c.id))?.numberId);
  const [numberId, setNumberId] = useState(firstNumber);
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set(preselected));
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const [when, setWhen] = useState<'now' | 'later' | 'repeat'>(initialWhen);
  const [content, setContent] = useState<'text' | 'poll'>('text');
  const [poll, setPoll] = useState({ question: '', options: ['', ''], multi: false });
  const [rule, setRule] = useState<RecurrenceRule>(DEFAULT_RULE);
  const [timezone, setTimezone] = useState(browserTimezone);
  const [endsAt, setEndsAt] = useState('');
  const [at, setAt] = useState('');
  const [perMinute, setPerMinute] = useState(20);
  const [media, setMedia] = useState<{ url: string; mimetype: string; filename: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const visible = useMemo(
    () =>
      chats.filter(
        (c) =>
          c.numberId === numberId &&
          (!label || c.labels.some((l) => l.id === label)) &&
          (!kind || c.kind === kind) &&
          (!q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase())),
      ),
    [chats, numberId, label, kind, q],
  );
  const chosen = chats.filter((c) => selected.has(c.id) && c.numberId === numberId);
  const sample = chosen[0];
  const preview = sample ? renderVariables(body, chatVariables({ name: sample.name, phone: sample.phone, properties: sample.properties })) : body;
  const minutes = Math.max(1, Math.ceil(chosen.length / Math.max(1, perMinute)));
  const vars = ['name', 'first_name', 'phone', ...properties.map((p) => `prop.${p.key}`)];

  function insertVar(v: string) {
    const el = bodyRef.current;
    const token = `{{${v}}}`;
    if (!el) return setBody((b) => b + token);
    const start = el.selectionStart ?? body.length;
    const next = body.slice(0, start) + token + body.slice(el.selectionEnd ?? start);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function upload(file: File) {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/groups/upload', { method: 'POST', body: form });
    const data = (await res.json().catch(() => ({}))) as { url?: string; mimetype?: string; filename?: string; error?: string };
    if (!res.ok || !data.url) setError(errText(data.error ?? 'upload_failed'));
    else setMedia({ url: data.url, mimetype: data.mimetype ?? file.type, filename: data.filename ?? file.name });
  }

  const number = numbers.find((n) => n.id === numberId);
  const pollsOk = number?.caps.polls ?? false;
  const pollPayload = content === 'poll' ? { question: poll.question, options: poll.options.map((o) => o.trim()).filter(Boolean), multi: poll.multi } : null;

  async function submit() {
    setError('');
    if (chosen.length === 0) return setError(errText('no_recipients'));
    if (pollPayload) {
      if (!pollsOk) return setError(errText('polls_unsupported'));
      if (!pollPayload.question.trim()) return setError(errText('poll_question'));
      if (pollPayload.options.length < 2) return setError(errText('poll_options'));
    } else if (!body.trim() && !media) return setError(errText('empty_message'));
    if (when === 'repeat') {
      const bad = checkRule(rule);
      if (bad) return setError(errText(bad));
      setBusy(true);
      const res = await api<{ id: string }>('/api/groups/recurring', {
        body: { numberId, name, body, media: pollPayload ? null : media, poll: pollPayload, chatIds: chosen.map((c) => c.id), rule, timezone, endsAt: endsIso(endsAt), perMinute },
      });
      setBusy(false);
      if (!res.data) return setError(errText(res.error));
      router.push(`/app/groups/broadcasts/recurring/${res.data.id}`);
      return;
    }
    let scheduledAt: string | null = null;
    if (when === 'later') {
      const ts = Date.parse(at);
      if (!Number.isFinite(ts) || ts < Date.now()) return setError(errText('invalid_date'));
      scheduledAt = new Date(ts).toISOString();
    }
    setBusy(true);
    const res = await api<{ id: string }>('/api/groups/broadcasts', {
      body: { numberId, name, body, media: pollPayload ? null : media, poll: pollPayload, chatIds: chosen.map((c) => c.id), scheduledAt, perMinute },
    });
    setBusy(false);
    if (!res.data) return setError(errText(res.error));
    router.push(`/app/groups/broadcasts/${res.data.id}`);
  }

  return (
    <form
      className="gr-composer-page"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="gr-composer-main">
        <div className="ui-fields">
          <div className="ui-fields-2">
            <label className="ui-field">
              <span className="label">{t('broadcasts.name')}</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={t('broadcasts.namePlaceholder')} />
            </label>
            <label className="ui-field">
              <span className="label">{t('broadcasts.from')}</span>
              <select
                className="select"
                value={numberId}
                onChange={(e) => {
                  setNumberId(e.target.value);
                  setSelected(new Set());
                }}
              >
                <NumberOptions numbers={numbers} />
              </select>
            </label>
          </div>
          <div className="gr-composer-tabs ui-tabs" role="tablist" aria-label={t('polls.contentLabel')}>
            <button type="button" role="tab" className="ui-tab" aria-selected={content === 'text'} onClick={() => setContent('text')}>
              {t('polls.modeText')}
            </button>
            <button type="button" role="tab" className="ui-tab" aria-selected={content === 'poll'} onClick={() => setContent('poll')}>
              {t('polls.modePoll')}
            </button>
          </div>
          {content === 'poll' ? (
            <>
              {!pollsOk && (
                <p className="gr-banner is-bad" role="alert">
                  {t('polls.unsupported')}
                </p>
              )}
              <PollFields question={poll.question} options={poll.options} multi={poll.multi} onChange={setPoll} idPrefix="bc" />
            </>
          ) : (
          <>
          <label className="ui-field">
            <span className="label">{t('broadcasts.message')}</span>
            <textarea ref={bodyRef} className="textarea" rows={6} value={body} onChange={(e) => setBody(e.target.value)} maxLength={4096} required={!media && content === 'text'} />
          </label>
          <div className="gr-vars" aria-label={t('broadcasts.variables')}>
            <span className="ui-help">{t('broadcasts.variables')}</span>
            {vars.map((v) => (
              <button key={v} type="button" className="btn btn-ghost btn-sm gr-mono" onClick={() => insertVar(v)}>
                {`{{${v}}}`}
              </button>
            ))}
          </div>
          <div className="gr-inline-form">
            <label className="btn btn-secondary btn-sm">
              {t('thread.attach')}
              <input
                type="file"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                  e.target.value = '';
                }}
              />
            </label>
            {media && (
              <span className="gr-attachment">
                {media.filename}
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMedia(null)}>
                  {t('common.remove')}
                </button>
              </span>
            )}
          </div>
          </>
          )}
          <fieldset className="ui-field">
            <legend className="label">{t('broadcasts.when')}</legend>
            <div className="gr-inline-form">
              <label className="gr-check-label">
                <input type="radio" name="when" checked={when === 'now'} onChange={() => setWhen('now')} />
                {t('broadcasts.now')}
              </label>
              <label className="gr-check-label">
                <input type="radio" name="when" checked={when === 'later'} onChange={() => setWhen('later')} />
                {t('broadcasts.later')}
              </label>
              <label className="gr-check-label">
                <input type="radio" name="when" checked={when === 'repeat'} onChange={() => setWhen('repeat')} />
                {t('recurring.option')}
              </label>
              {when === 'later' && (
                <input className="input" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} aria-label={t('thread.scheduleAt')} required />
              )}
            </div>
          </fieldset>
          {when === 'repeat' && (
            <RecurrenceFields rule={rule} onChange={setRule} timezone={timezone} onTimezone={setTimezone} endsAt={endsAt} onEndsAt={setEndsAt} />
          )}
          <label className="ui-field">
            <span className="label">{t('broadcasts.perMinute')}</span>
            <input className="input gr-narrow" type="number" min={1} max={60} value={perMinute} onChange={(e) => setPerMinute(Math.min(60, Math.max(1, Number(e.target.value) || 1)))} />
            <span className="ui-help">{t('broadcasts.perMinuteHelp', { minutes })}</span>
          </label>
          <div className="gr-preview">
            <p className="label">{t('broadcasts.preview', { name: sample?.name ?? '' })}</p>
            <p className="gr-bubble gr-pre">{pollPayload ? `📊 ${pollPayload.question}\n${pollPayload.options.map((o) => `○ ${o}`).join('\n')}` : preview || t('broadcasts.previewEmpty')}</p>
          </div>
          {error && (
            <p className="ui-error" role="alert">
              {error}
            </p>
          )}
          <div>
            <button type="submit" className="btn btn-primary" aria-busy={busy || undefined} disabled={busy}>
              {when === 'repeat'
                ? t('recurring.create', { n: chosen.length })
                : when === 'later'
                  ? t('broadcasts.schedule', { n: chosen.length })
                  : t('broadcasts.sendNow', { n: chosen.length })}
            </button>
          </div>
          <p className="ui-help">{t('broadcasts.risk')}</p>
        </div>
      </div>

      <aside className="gr-recipients" aria-label={t('broadcasts.recipients')}>
        <div className="gr-detail-head">
          <h3 className="gr-detail-title">{t('broadcasts.recipientsCount', { n: chosen.length })}</h3>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setSelected((prev) => new Set([...prev, ...visible.map((c) => c.id)]))}
          >
            {t('broadcasts.selectVisible', { n: visible.length })}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>
            {t('list.clear')}
          </button>
        </div>
        <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('list.search')} aria-label={t('list.search')} />
        <div className="gr-inline-form">
          <select className="select" value={kind} onChange={(e) => setKind(e.target.value)} aria-label={t('inbox.kind')}>
            <option value="">{t('inbox.kindAll')}</option>
            <option value="group">{t('inbox.kindGroups')}</option>
            <option value="dm">{t('inbox.kindDms')}</option>
          </select>
          <select className="select" value={label} onChange={(e) => setLabel(e.target.value)} aria-label={t('inbox.label')}>
            <option value="">{t('inbox.labelAll')}</option>
            {labels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        {visible.length === 0 ? (
          <p className="ui-help">{t('broadcasts.noChats')}</p>
        ) : (
          <ul className="gr-pick-list">
            {visible.map((c) => (
              <li key={c.id}>
                <label className="gr-check-label">
                  <input
                    type="checkbox"
                    className="ui-check"
                    checked={selected.has(c.id)}
                    onChange={() =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(c.id)) next.delete(c.id);
                        else next.add(c.id);
                        return next;
                      })
                    }
                  />
                  <ChatPlate name={c.name} kind={c.kind} />
                  <span className="gr-pick-name">{c.name}</span>
                  {c.labels.slice(0, 1).map((l) => (
                    <LabelTag key={l.id} name={l.name} color={l.color} />
                  ))}
                </label>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </form>
  );
}
