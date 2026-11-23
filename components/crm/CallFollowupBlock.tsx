'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import type { FollowupView } from '@/lib/crm-ai-followup';
import { formatMoney } from '@/lib/crm-money';
import { aiErrorKey, dayFromToday } from './aiShared';
import { useCrmAdmin } from './CrmViewer';
import ApprovalDialog, { readApproval, type ApprovalInfo } from './ApprovalDialog';
import StageRequirementsDialog, { checkStageMove, readRequirements, type StageRequirements } from './StageRequirementsDialog';

type Item = FollowupView;
type FieldValue = string | number | boolean;

const OWN_ERRORS = new Set(['already_done', 'field_readonly']);

/**
 * IA tras una llamada o reunión (C5): propone cambios de propiedades, avanzar
 * el deal, un email de seguimiento y tareas, como tarjetas que la persona
 * aplica, edita o descarta de a una. Nada cambia sin su click. Las propuestas
 * son solo de quien las pidió (lib/crm-ai-followup.ts).
 */
export default function CallFollowupBlock({ activityId, locale }: { activityId: string; locale: string }) {
  const t = useTranslations('crm.ai');
  const isAdmin = useCrmAdmin();
  const router = useRouter();
  const headingId = useId();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/crm/ai/followups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ activityId, locale }),
    }).catch(() => null);
    const json = (await res?.json().catch(() => null)) as { items?: Item[]; error?: string } | null;
    setBusy(false);
    if (!res?.ok || !json?.items) {
      setError(t(aiErrorKey(json?.error, isAdmin)));
      return;
    }
    setItems(json.items);
  }

  async function openPanel() {
    setOpen(true);
    if (items) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/crm/ai/followups?activityId=${encodeURIComponent(activityId)}&locale=${locale}`).catch(() => null);
    const json = (await res?.json().catch(() => null)) as { items?: Item[]; generatedAt?: string | null; error?: string } | null;
    setBusy(false);
    if (!res?.ok || !json?.items) {
      setError(t(aiErrorKey(json?.error, isAdmin)));
      return;
    }
    if (json.generatedAt) setItems(json.items);
    else await generate();
  }

  function update(id: string, patch: Partial<Item> | null) {
    setItems((list) => (list ?? []).flatMap((i) => (i.id !== id ? [i] : patch === null ? [] : [{ ...i, ...patch }])));
  }

  if (!open) {
    return (
      <div className="ai-call" data-followup-activity={activityId}>
        <button type="button" className="btn btn-ghost btn-sm ai-fu-open" onClick={openPanel} data-testid="ai-followup-open">
          {t('followup.open')}
        </button>
      </div>
    );
  }

  const pending = (items ?? []).filter((i) => i.status === 'pending').length;

  return (
    <section className="ai-call ai-call-filled ai-fu" aria-labelledby={headingId} aria-busy={busy} data-testid="ai-followup" data-followup-activity={activityId}>
      <div className="ai-call-head">
        <button type="button" className="ai-call-toggle" aria-expanded="true" onClick={() => setOpen(false)} id={headingId}>
          {t('followup.title')}
        </button>
        {items && items.length > 0 && <span className="ai-sentiment">{t('followup.pending', { count: pending })}</span>}
        <button type="button" className="btn btn-ghost btn-sm ai-fu-regen" onClick={generate} disabled={busy}>
          {busy ? t('working') : t('followup.regenerate')}
        </button>
      </div>
      {busy && !items && <p className="muted ai-empty">{t('followup.loading')}</p>}
      {items && items.length === 0 && !busy && <p className="muted ai-empty">{t('followup.empty')}</p>}
      {items && items.length > 0 && (
        <>
          <p className="muted ai-fu-hint">{t('followup.hint')}</p>
          <ul className="ai-fu-list">
            {items.map((item) => (
              <FollowupCard
                key={item.id}
                item={item}
                locale={locale}
                onDone={() => {
                  update(item.id, { status: 'applied' });
                  router.refresh();
                }}
                onDiscard={() => update(item.id, null)}
              />
            ))}
          </ul>
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

interface Labels {
  empty: string;
  yes: string;
  no: string;
  /** Valor de un enum fijo (crm.enums.*). */
  enumLabel: (enumKey: string, v: string) => string;
}

function useLabels(): Labels {
  const t = useTranslations('crm.ai');
  const tc = useTranslations('crm');
  return {
    empty: t('followup.emptyValue'),
    yes: t('followup.yes'),
    no: t('followup.no'),
    enumLabel: (k, v) => (tc.has(`enums.${k}.${v}` as 'enums.priority.low') ? tc(`enums.${k}.${v}` as 'enums.priority.low') : v),
  };
}

function displayValue(field: NonNullable<Item['field']>, v: unknown, locale: string, l: Labels): string {
  if (v === null || v === undefined || v === '') return l.empty;
  if (field.enumKey) return l.enumLabel(field.enumKey, String(v));
  if (field.type === 'boolean') return v === true || v === 'true' ? l.yes : l.no;
  if (field.type === 'currency' && Number.isFinite(Number(v))) return formatMoney(Number(v), field.currency ?? 'USD', locale, true);
  if (field.type === 'number' && Number.isFinite(Number(v))) return new Intl.NumberFormat(locale).format(Number(v));
  return String(v);
}

function formatDue(day: string, locale: string): string {
  const d = new Date(`${day}T12:00:00`);
  return Number.isNaN(d.getTime()) ? day : new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(d);
}

async function markApplied(id: string): Promise<void> {
  await fetch(`/api/crm/ai/followups/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'applied' }),
  }).catch(() => null);
}

function FollowupCard({
  item,
  locale,
  onDone,
  onDiscard,
}: {
  item: Item;
  locale: string;
  onDone: () => void;
  onDiscard: () => void;
}) {
  const t = useTranslations('crm.ai');
  const tc = useTranslations('crm');
  const labels = useLabels();
  const formId = useId();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState<FieldValue>(item.field?.value ?? '');
  const [email, setEmail] = useState({ to: item.email?.to ?? '', subject: item.email?.subject ?? '', body: item.email?.body ?? '' });
  const [task, setTask] = useState({ title: item.task?.title ?? '', due: dayFromToday(item.task?.dueInDays ?? 1) });
  const [req, setReq] = useState<StageRequirements | null>(null);
  const [approval, setApproval] = useState<ApprovalInfo | null>(null);
  const done = item.status === 'applied';

  const failWith = async (res: Response | null) => {
    const body = (await res?.json().catch(() => null)) as { error?: string } | null;
    const code = body?.error;
    setError(code && OWN_ERRORS.has(code) ? t(`followup.errors.${code}` as 'followup.errors.already_done') : t(aiErrorKey(code)));
  };

  async function discard() {
    setBusy(true);
    const res = await fetch(`/api/crm/ai/followups/${item.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'discard' }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) onDiscard();
    else await failWith(res);
  }

  async function apply() {
    if (busy) return;
    setBusy(true);
    setError(null);
    let res: Response | null = null;
    if (item.kind === 'field') {
      res = await fetch(`/api/crm/ai/followups/${item.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'apply', ...(editing ? { value } : {}) }),
      }).catch(() => null);
      setBusy(false);
      if (!res?.ok) return failWith(res);
      setEditing(false);
      return onDone();
    }
    if (item.kind === 'stage' && item.stage) {
      const check = await checkStageMove(item.stage.dealId, item.stage.stageId);
      if (check?.approval) {
        setBusy(false);
        setApproval(check.approval);
        return;
      }
      if (check && (check.missing.length || check.adminRequired)) {
        setBusy(false);
        setReq(check);
        return;
      }
      res = await fetch(`/api/crm/deals/${item.stage.dealId}/move`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stageId: item.stage.stageId }),
      }).catch(() => null);
      if (!res?.ok) {
        setBusy(false);
        const needs = await readApproval(res);
        if (needs) return setApproval(needs);
        const r = await readRequirements(res);
        if (r) return setReq(r);
        return failWith(res);
      }
    } else if (item.kind === 'email' && item.email) {
      if (!email.to.trim()) {
        setBusy(false);
        setEditing(true);
        setError(t('errors.missing_recipient'));
        return;
      }
      res = await fetch('/api/crm/emails', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recordType: item.email.recordType, recordId: item.email.recordId, to: email.to.trim(), subject: email.subject.trim(), body: email.body.trim() }),
      }).catch(() => null);
      if (!res?.ok) {
        setBusy(false);
        return failWith(res);
      }
    } else if (item.kind === 'task' && item.task) {
      res = await fetch('/api/crm/activities', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'task',
          subject: task.title.trim().slice(0, 200),
          dueAt: `${task.due} 09:00`,
          contactId: item.task.contactId ?? undefined,
          companyId: item.task.companyId ?? undefined,
          dealId: item.task.dealId ?? undefined,
        }),
      }).catch(() => null);
      if (!res?.ok) {
        setBusy(false);
        return failWith(res);
      }
    }
    await markApplied(item.id);
    setBusy(false);
    setEditing(false);
    onDone();
  }

  const kindLabel = t(`followup.kind.${item.kind}`);
  const record = item.field?.recordName ?? item.stage?.dealName ?? '';
  const subject =
    item.field?.label ?? (item.stage ? item.stage.stageName : item.email ? email.subject : item.task ? task.title : '');
  const applyLabel =
    item.kind === 'email' ? t('followup.send') : item.kind === 'task' ? t('followup.addTask') : item.kind === 'stage' ? t('followup.move') : t('followup.apply');
  const doneLabel =
    item.kind === 'email' ? t('followup.sent') : item.kind === 'task' ? t('followup.taskAdded') : item.kind === 'stage' ? t('followup.moved') : t('followup.applied');
  const canApply = item.kind !== 'email' || (email.subject.trim() !== '' && email.body.trim() !== '');

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape' && editing) {
      e.stopPropagation();
      setEditing(false);
    }
  }

  return (
    <li className={`ai-fu-card${done ? ' is-done' : ''}`} data-testid="ai-followup-card" data-kind={item.kind} data-status={item.status} onKeyDown={onKeyDown}>
      <p className="ai-fu-head">
        <span className="ai-proposal-title">{kindLabel}</span>
        {record && <span className="ai-fu-record">{record}</span>}
      </p>

      {item.kind === 'field' && item.field && !editing && (
        <p className="ai-fu-change" data-testid="ai-followup-change">
          <span className="ai-fu-label">{item.field.label}</span>
          <span className="ai-fu-values">
            <span className="ai-fu-from">{displayValue(item.field, item.field.current, locale, labels)}</span>
            <span aria-hidden="true"> → </span>
            <strong className="ai-fu-new">{displayValue(item.field, done ? item.field.value : value, locale, labels)}</strong>
          </span>
        </p>
      )}
      {item.kind === 'stage' && item.stage && (
        <p className="ai-fu-change">
          <span className="ai-fu-label">{tc('deals.form.stage')}</span>
          <span className="ai-fu-values">
            <span className="ai-fu-from">{item.stage.fromStageName}</span>
            <span aria-hidden="true"> → </span>
            <strong className="ai-fu-new">{item.stage.stageName}</strong>
          </span>
        </p>
      )}
      {item.kind === 'email' && !editing && (
        <div className="ai-draft ai-fu-email">
          <p className="muted">
            {t('followup.toLabel')}: {email.to || t('followup.emptyValue')}
          </p>
          <p className="ai-draft-subject">{email.subject}</p>
          <p className="ai-text ai-fu-body">{email.body}</p>
        </div>
      )}
      {item.kind === 'task' && !editing && (
        <p className="ai-fu-change">
          <span className="ai-fu-task">{task.title}</span>
          <span className="muted ai-fu-due">{formatDue(task.due, locale)}</span>
        </p>
      )}

      {editing && !done && (
        <form
          id={formId}
          className="ai-fu-form"
          onSubmit={(e) => {
            e.preventDefault();
            void apply();
          }}
        >
          {item.kind === 'field' && item.field && <FieldEditor field={item.field} value={value} onChange={setValue} labels={labels} />}
          {item.kind === 'email' && (
            <>
              <label className="ui-field">
                <span className="label">{t('followup.toLabel')}</span>
                <input className="input" type="email" value={email.to} onChange={(e) => setEmail({ ...email, to: e.target.value })} maxLength={320} autoFocus />
              </label>
              <label className="ui-field">
                <span className="label">{t('followup.subject')}</span>
                <input className="input" value={email.subject} onChange={(e) => setEmail({ ...email, subject: e.target.value })} maxLength={200} />
              </label>
              <label className="ui-field">
                <span className="label">{t('followup.body')}</span>
                <textarea className="textarea" rows={7} value={email.body} onChange={(e) => setEmail({ ...email, body: e.target.value })} maxLength={5000} />
              </label>
            </>
          )}
          {item.kind === 'task' && (
            <>
              <label className="ui-field">
                <span className="label">{t('followup.taskTitle')}</span>
                <input className="input" value={task.title} onChange={(e) => setTask({ ...task, title: e.target.value })} maxLength={200} autoFocus />
              </label>
              <label className="ui-field">
                <span className="label">{t('followup.due')}</span>
                <input className="input" type="date" value={task.due} onChange={(e) => setTask({ ...task, due: e.target.value })} required />
              </label>
            </>
          )}
        </form>
      )}

      {item.reason && <p className="muted ai-fu-reason">{item.reason}</p>}

      {done ? (
        <p className="ai-proposal-done" data-testid="ai-followup-done">
          {doneLabel}
        </p>
      ) : (
        <div className="ai-actions ai-fu-actions">
          <button
            type={editing ? 'submit' : 'button'}
            form={editing ? formId : undefined}
            className="btn btn-primary btn-sm"
            onClick={editing ? undefined : apply}
            disabled={busy || !canApply || (item.kind === 'task' && !task.title.trim())}
            aria-label={`${applyLabel}: ${subject}`}
            data-testid="ai-followup-apply"
          >
            {busy ? t('working') : applyLabel}
          </button>
          {item.kind !== 'stage' &&
            (editing ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)} disabled={busy}>
                {t('followup.cancel')}
              </button>
            ) : (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)} disabled={busy} aria-label={`${t('followup.edit')}: ${subject}`} data-testid="ai-followup-edit">
                {t('followup.edit')}
              </button>
            ))}
          <button type="button" className="btn btn-ghost btn-sm" onClick={discard} disabled={busy} aria-label={`${t('followup.discard')}: ${subject}`} data-testid="ai-followup-discard">
            {t('followup.discard')}
          </button>
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {req && item.stage && (
        <StageRequirementsDialog
          dealId={item.stage.dealId}
          request={{ stageId: item.stage.stageId }}
          requirements={req}
          onCancel={() => setReq(null)}
          onDone={async () => {
            setReq(null);
            await markApplied(item.id);
            onDone();
          }}
        />
      )}
      {approval && item.stage && <ApprovalDialog dealId={item.stage.dealId} info={approval} locale={locale} onClose={() => setApproval(null)} />}
    </li>
  );
}

function FieldEditor({
  field,
  value,
  onChange,
  labels,
}: {
  field: NonNullable<Item['field']>;
  value: FieldValue;
  onChange: (v: FieldValue) => void;
  labels: Labels;
}) {
  const label = <span className="label">{field.label}</span>;
  if (field.type === 'select' || field.type === 'boolean') {
    const options =
      field.type === 'boolean'
        ? [
            { value: 'true', label: labels.yes },
            { value: 'false', label: labels.no },
          ]
        : field.options.map((o) => ({ value: o, label: field.enumKey ? labels.enumLabel(field.enumKey, o) : o }));
    return (
      <label className="ui-field">
        {label}
        <select className="select" value={String(value)} onChange={(e) => onChange(field.type === 'boolean' ? e.target.value === 'true' : e.target.value)} autoFocus>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (field.type === 'longtext') {
    return (
      <label className="ui-field">
        {label}
        <textarea className="textarea" rows={4} value={String(value)} onChange={(e) => onChange(e.target.value)} maxLength={2000} autoFocus />
      </label>
    );
  }
  const type = field.type === 'date' ? 'date' : field.type === 'number' || field.type === 'currency' ? 'number' : field.type === 'url' ? 'url' : 'text';
  return (
    <label className="ui-field">
      {label}
      <input
        className="input"
        type={type}
        step={type === 'number' ? 'any' : undefined}
        min={type === 'number' ? 0 : undefined}
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
        maxLength={type === 'text' || type === 'url' ? 500 : undefined}
        required
        autoFocus
      />
    </label>
  );
}
