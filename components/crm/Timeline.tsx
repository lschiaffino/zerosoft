'use client';

import { isDefaultOutcome } from '@/lib/crm-calls';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import type { EmailThreadView } from '@/lib/crm-email';
import EmailThread from './EmailThread';
import CrmIcon from './CrmIcon';
import FilesPanel, { type FileItem } from './FilesPanel';
import MentionTextarea, { MentionText } from './MentionTextarea';
import type { Mentionable } from '@/lib/crm-mentions';

export type TimelineRecordType = 'contact' | 'company' | 'deal';

export interface TimelineItem {
  id: string;
  type: 'note' | 'task' | 'call' | 'meeting' | 'email';
  subject: string;
  body: string;
  due_at: string | null;
  done: 0 | 1;
  pinned: 0 | 1;
  direction: string;
  outcome: string;
  /** Llamadas: 'whatsapp' si el toque fue por WhatsApp. */
  channel?: string;
  duration_min: number | null;
  contact_name?: string | null;
  company_name?: string | null;
  deal_name?: string | null;
  created_at: string;
  /** Thread de emails (Gmail o enviados desde el CRM): read-only, se muestra agrupado. */
  external?: boolean;
  from_email?: string;
  thread?: EmailThreadView;
  /** Adjuntos de la actividad. */
  files?: FileItem[];
}

/** Herramientas del composer de email: templates/snippets, IA y tracking. */
export interface EmailTools {
  templates: Array<{ id: string; kind: 'template' | 'snippet'; name: string; subject: string; body: string }>;
  aiEnabled: boolean;
  trackingDefault: boolean;
  /** Para el render de variables (preview) y el contexto de la IA. */
  contactId?: string;
  dealId?: string;
}

interface TimelineProps {
  recordType: TimelineRecordType;
  recordId: string;
  items: TimelineItem[];
  emptyLabel: string;
  locale: string;
  /** Email precargado en el composer cuando type === email. */
  defaultEmail?: string;
  emailTools?: EmailTools;
  /** Personas del workspace que se pueden @mencionar en notas y tareas. */
  mentionables?: Mentionable[];
}

/** Tipos donde el texto acepta @menciones (y avisan). */
const MENTION_TYPES = new Set(['note', 'task']);

const TYPES = ['note', 'task', 'call', 'meeting', 'email'] as const;
type ActivityType = (typeof TYPES)[number];

const SUBMIT_KEYS: Record<ActivityType, string> = {
  note: 'common.addNote',
  task: 'common.addTask',
  call: 'common.logCall',
  meeting: 'common.logMeeting',
  email: 'common.sendEmail',
};

/** Cmd+Enter (Mac) o Ctrl+Enter, sin una sugerencia de @mención abierta que ya lo usó. */
function isModEnter(e: { key: string; metaKey: boolean; ctrlKey: boolean; defaultPrevented: boolean; nativeEvent: { isComposing?: boolean } }): boolean {
  return e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.defaultPrevented && !e.nativeEvent.isComposing;
}

function formatWhen(iso: string, locale: string): string {
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

function formatDay(iso: string, locale: string): string {
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric' }).format(
    d,
  );
}

/**
 * Timeline reutilizable (contacts / companies / deals): composer con
 * selector de tipo + lista filtrable con done toggle y delete.
 * El padre (server) pasa los items; tras cada mutación router.refresh().
 */
export default function Timeline({
  recordType,
  recordId,
  items,
  emptyLabel,
  locale,
  defaultEmail = '',
  emailTools,
  mentionables = [],
}: TimelineProps) {
  const t = useTranslations('crm');
  const router = useRouter();

  // Composer. El tipo sale de la pestaña activa; solo en "All" se elige con
  // el select del composer (allType). Una sola fuente: lo que se ve es lo que
  // se guarda.
  const [allType, setAllType] = useState<ActivityType>('note');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [emailTo, setEmailTo] = useState(defaultEmail);
  const [dueAt, setDueAt] = useState('');
  const [direction, setDirection] = useState('');
  const [durationMin, setDurationMin] = useState('');
  const [posting, setPosting] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<EmailThreadView | null>(null);
  const [tracking, setTracking] = useState(emailTools?.trackingDefault ?? true);
  const [missing, setMissing] = useState<string[]>([]);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Zoom (CRM › Ajustes › Integraciones): botón "Link de Zoom" en las reuniones.
  const hasMeetings = items.some((i) => i.type === 'meeting' && !i.external);
  const [zoomOn, setZoomOn] = useState(false);
  const [zoomBusy, setZoomBusy] = useState<string | null>(null);
  useEffect(() => {
    if (!hasMeetings) return;
    let alive = true;
    fetch('/api/crm/apps')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { apps?: Array<{ key: string; connected: boolean }> } | null) => {
        if (alive) setZoomOn(!!d?.apps?.some((a) => a.key === 'zoom' && a.connected));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [hasMeetings]);

  async function createZoom(id: string) {
    setZoomBusy(id);
    setNotice(null);
    const res = await fetch(`/api/crm/activities/${id}/zoom`, { method: 'POST' }).catch(() => null);
    setZoomBusy(null);
    if (res?.ok) router.refresh();
    else setNotice(t('apps.zoom.error'));
  }

  // Lista
  const [filter, setFilter] = useState<ActivityType | 'all'>('all');
  const type: ActivityType = filter === 'all' ? allType : filter;
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  // Edición inline (subject + body)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSubject, setEditSubject] = useState('');
  const [editBody, setEditBody] = useState('');

  const filtered = filter === 'all' ? items : items.filter((i) => i.type === filter);
  const templates = emailTools?.templates.filter((x) => x.kind === 'template') ?? [];
  const snippets = emailTools?.templates.filter((x) => x.kind === 'snippet') ?? [];

  function errorText(code: string | undefined): string {
    if (!code) return t('errors.generic');
    return t.has(`errors.${code}`) ? t(`errors.${code}` as 'errors.generic') : t('errors.generic');
  }

  /** Render de variables con el contacto/deal del registro (y aviso de faltantes). */
  async function render(subjectTpl: string, bodyTpl: string): Promise<{ subject: string; body: string } | null> {
    const res = await fetch('/api/crm/email-templates/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        subject: subjectTpl,
        body: bodyTpl,
        contactId: emailTools?.contactId,
        dealId: emailTools?.dealId,
      }),
    }).catch(() => null);
    if (!res?.ok) return null;
    const data = (await res.json()) as { subject: string; body: string; missing: string[] };
    setMissing(data.missing);
    return { subject: data.subject, body: data.body };
  }

  async function insertTemplate(id: string) {
    const tpl = templates.find((x) => x.id === id);
    if (!tpl) return;
    const out = await render(tpl.subject, tpl.body);
    if (!out) return;
    if (!replyTo) setSubject(out.subject);
    setBody(out.body);
  }

  async function insertSnippet(id: string) {
    const sn = snippets.find((x) => x.id === id);
    if (!sn) return;
    const out = await render('', sn.body);
    if (!out) return;
    setBody((b) => (b.trim() ? `${b.replace(/\s+$/, '')}\n\n${out.body}` : out.body));
  }

  async function aiDraft() {
    if (!emailTools?.contactId || aiBusy) return;
    setAiBusy(true);
    setEmailError(null);
    const res = await fetch('/api/crm/emails/draft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contactId: emailTools.contactId,
        instructions: aiPrompt.trim() || undefined,
        subject: subject.trim() || undefined,
      }),
    }).catch(() => null);
    setAiBusy(false);
    const data = (await res?.json().catch(() => null)) as { body?: string; error?: string } | null;
    if (!res?.ok || !data?.body) {
      setEmailError(errorText(data?.error));
      return;
    }
    setBody(data.body);
    setAiOpen(false);
    setAiPrompt('');
  }

  function startReply(thread: EmailThreadView) {
    setReplyTo(thread);
    setFilter('email');
    setAllType('email');
    const base = thread.subject || thread.messages[thread.messages.length - 1]?.subject || '';
    setSubject(/^re:/i.test(base) ? base : `Re: ${base}`);
    const lastIn = [...thread.messages].reverse().find((m) => m.direction === 'in');
    const addr = lastIn ? /[^\s<>"]+@[^\s<>"]+/.exec(lastIn.from)?.[0] : null;
    if (addr) setEmailTo(addr);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setEmailError(null);
    if (type === 'email') {
      if (!emailTo.trim() || (!subject.trim() && !body.trim())) return;
      setPosting(true);
      const res = await fetch('/api/crm/emails', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          recordType,
          recordId,
          to: emailTo.trim(),
          subject: subject.trim(),
          body: body.trim(),
          tracking,
          threadId: replyTo?.threadId,
        }),
      }).catch(() => null);
      setPosting(false);
      const data = (await res?.json().catch(() => ({}))) as { error?: string; via?: 'gmail' | 'system' } | undefined;
      if (res && res.ok) {
        setSubject('');
        setBody('');
        setEmailTo(defaultEmail);
        setReplyTo(null);
        setMissing([]);
        setNotice(data?.via === 'system' ? t('email.sentSystem') : t('email.sentGmail'));
        router.refresh();
      } else {
        setEmailError(errorText(data?.error));
      }
      return;
    }

    if (!subject.trim() && !body.trim()) return;
    setPosting(true);
    const payload: Record<string, unknown> = {
      type,
      subject: subject.trim() || undefined,
      body: body.trim() || undefined,
      [`${recordType}Id`]: recordId,
    };
    if (type === 'task' && dueAt) payload.dueAt = dueAt;
    if (type === 'call' && direction) payload.direction = direction;
    if (type === 'meeting' && durationMin) payload.durationMin = Number(durationMin);
    await fetch('/api/crm/activities', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => null);
    setPosting(false);
    setSubject('');
    setBody('');
    setDueAt('');
    setDirection('');
    setDurationMin('');
    router.refresh();
  }

  // Cmd/Ctrl+Enter guarda desde cualquier campo del composer (como HubSpot).
  function submitOnModEnter(e: React.KeyboardEvent<HTMLFormElement>) {
    if (!isModEnter(e)) return;
    e.preventDefault();
    if (posting) return;
    e.currentTarget.requestSubmit();
  }

  async function toggleDone(item: TimelineItem) {
    setBusyId(item.id);
    await fetch(`/api/crm/activities/${item.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ done: !item.done }),
    }).catch(() => null);
    setBusyId(null);
    router.refresh();
  }

  async function togglePin(item: TimelineItem) {
    setBusyId(item.id);
    await fetch(`/api/crm/activities/${item.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pinned: !item.pinned }),
    }).catch(() => null);
    setBusyId(null);
    router.refresh();
  }

  function startEdit(item: TimelineItem) {
    setEditingId(item.id);
    setEditSubject(item.subject);
    setEditBody(item.body);
  }

  async function saveEdit(item: TimelineItem) {
    setBusyId(item.id);
    const res = await fetch(`/api/crm/activities/${item.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subject: editSubject.trim(), body: editBody.trim() }),
    }).catch(() => null);
    setBusyId(null);
    if (res && res.ok) {
      setEditingId(null);
      router.refresh();
    }
  }

  async function remove(id: string) {
    setBusyId(id);
    await fetch(`/api/crm/activities/${id}`, { method: 'DELETE' }).catch(() => null);
    setBusyId(null);
    setConfirmId(null);
    router.refresh();
  }

  return (
    <div className="timeline-wrap">
      {/* Una sola fila de tabs (como HubSpot): filtra la lista y define qué
          tipo de actividad crea el composer. En "All" el tipo se elige con
          un select compacto dentro del composer. */}
      <div className="btn-group tl-filters" role="tablist" aria-label={t('common.activityType')}>
        <button
          type="button"
          role="tab"
          aria-selected={filter === 'all'}
          className="btn btn-secondary btn-sm"
          onClick={() => setFilter('all')}
        >
          {t('common.all')}
          {items.length > 0 && <span className="tl-count">{items.length}</span>}
        </button>
        {TYPES.map((v) => {
          const n = items.filter((i) => i.type === v).length;
          return (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={filter === v}
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setFilter(v);
                setAllType(v);
              }}
            >
              {t(`enums.activityType.${v}`)}
              {n > 0 && <span className="tl-count">{n}</span>}
            </button>
          );
        })}
      </div>

      <form className="tl-composer" onSubmit={submit} onKeyDown={submitOnModEnter}>
        {type === 'email' && replyTo && (
          <div className="em-replying">
            <span className="muted">{t('email.replyingTo', { subject: replyTo.subject || '—' })}</span>
            <button type="button" className="link-btn" onClick={() => { setReplyTo(null); setSubject(''); }}>
              {t('email.cancelReply')}
            </button>
          </div>
        )}
        {type === 'email' && (
          <input
            className="input"
            type="email"
            value={emailTo}
            onChange={(e) => setEmailTo(e.target.value)}
            placeholder={t('common.to')}
            required
          />
        )}
        <input
          className="input"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder={type === 'email' ? t('common.subject') : t('tasks.form.subject')}
          maxLength={500}
        />
        {MENTION_TYPES.has(type) && mentionables.length > 1 ? (
          <MentionTextarea
            className="textarea"
            rows={3}
            value={body}
            onChange={setBody}
            people={mentionables}
            placeholder={t('mentions.placeholder')}
            maxLength={5000}
            aria-label={t('tasks.form.body')}
          />
        ) : (
          <textarea
            className="textarea"
            rows={type === 'email' ? 6 : 3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={type === 'email' ? t('common.body') : t('tasks.form.body')}
            maxLength={type === 'email' ? 20000 : 5000}
          />
        )}
        {type === 'email' && emailTools && (
          <div className="em-tools">
            {templates.length > 0 && (
              <select
                className="filter-select"
                value=""
                onChange={(e) => insertTemplate(e.target.value)}
                aria-label={t('email.insertTemplate')}
              >
                <option value="">{t('email.insertTemplate')}</option>
                {templates.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            )}
            {snippets.length > 0 && (
              <select
                className="filter-select"
                value=""
                onChange={(e) => insertSnippet(e.target.value)}
                aria-label={t('email.insertSnippet')}
              >
                <option value="">{t('email.insertSnippet')}</option>
                {snippets.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            )}
            {emailTools.aiEnabled && emailTools.contactId && (
              <button type="button" className="btn btn-ghost btn-small" onClick={() => setAiOpen((v) => !v)} aria-expanded={aiOpen}>
                {t('email.aiDraft')}
              </button>
            )}
            <label className="em-check">
              <input type="checkbox" checked={tracking} onChange={(e) => setTracking(e.target.checked)} />
              {t('email.tracking')}
            </label>
          </div>
        )}
        {type === 'email' && aiOpen && (
          <div className="em-ai">
            <input
              className="input"
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder={t('email.aiPrompt')}
              maxLength={2000}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  aiDraft();
                }
              }}
            />
            <button type="button" className="btn btn-small" disabled={aiBusy} onClick={aiDraft}>
              {aiBusy ? t('email.aiDrafting') : t('email.aiDraft')}
            </button>
          </div>
        )}
        {type === 'email' && missing.length > 0 && (
          <p className="em-warn mono">{t('email.missingVars', { vars: missing.join(', ') })}</p>
        )}
        <div className="tl-composer-actions">
          <div className="tl-composer-extras">
            {filter === 'all' && (
              <select
                className="filter-select tl-type-select"
                value={type}
                onChange={(e) => setAllType(e.target.value as ActivityType)}
                aria-label={t('common.activityType')}
              >
                {TYPES.map((v) => (
                  <option key={v} value={v}>
                    {t(`enums.activityType.${v}`)}
                  </option>
                ))}
              </select>
            )}
            {type === 'task' && (
              <input
                className="input"
                type="date"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                aria-label={t('tasks.form.dueAt')}
              />
            )}
            {type === 'call' && (
              <select
                className="filter-select"
                value={direction}
                onChange={(e) => setDirection(e.target.value)}
                aria-label={t('common.optional')}
              >
                <option value="">—</option>
                <option value="inbound">{t('enums.direction.inbound')}</option>
                <option value="outbound">{t('enums.direction.outbound')}</option>
              </select>
            )}
            {type === 'meeting' && (
              <input
                className="input tl-duration"
                type="number"
                min={0}
                value={durationMin}
                onChange={(e) => setDurationMin(e.target.value)}
                placeholder={t('common.durationMin')}
                aria-label={t('common.durationMin')}
              />
            )}
          </div>
          <button
            type="submit"
            aria-keyshortcuts="Meta+Enter Control+Enter"
            className="btn btn-solid btn-small"
            disabled={posting || (!subject.trim() && !body.trim()) || (type === 'email' && !emailTo.trim())}
          >
            {posting ? t('common.creating') : t(SUBMIT_KEYS[type])}
          </button>
        </div>
        {emailError && <p className="form-error">{emailError}</p>}
        {notice && !emailError && <p className="muted em-notice">{notice}</p>}
      </form>

      {filtered.length === 0 ? (
        <p className="muted">{emptyLabel}</p>
      ) : (
        <div className="timeline">
          {filtered.map((item) => (
            <div
              key={item.id}
              className={`tl-item${item.done ? ' tl-done' : ''}${item.pinned ? ' tl-pinned' : ''}${busyId === item.id ? ' row-busy' : ''}`}
            >
              <span className={`tl-dot ${item.type}`} aria-hidden />
              {item.thread ? (
                <EmailThread thread={item.thread} locale={locale} onReply={emailTools ? startReply : undefined} />
              ) : editingId === item.id ? (
                <div
                  className="tl-edit"
                  onKeyDown={(e) => {
                    if (isModEnter(e)) {
                      e.preventDefault();
                      void saveEdit(item);
                    }
                  }}
                >
                  <input
                    className="input"
                    value={editSubject}
                    onChange={(e) => setEditSubject(e.target.value)}
                    placeholder={t('tasks.form.subject')}
                    maxLength={500}
                  />
                  {MENTION_TYPES.has(item.type) && mentionables.length > 1 ? (
                    <MentionTextarea
                      className="textarea"
                      rows={3}
                      value={editBody}
                      onChange={setEditBody}
                      people={mentionables}
                      placeholder={t('tasks.form.body')}
                      maxLength={5000}
                      aria-label={t('tasks.form.body')}
                    />
                  ) : (
                    <textarea
                      className="textarea"
                      rows={3}
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      placeholder={t('tasks.form.body')}
                      maxLength={5000}
                    />
                  )}
                  <div className="form-actions">
                    <button
                      type="button"
                      className="btn btn-solid btn-small"
                      disabled={busyId === item.id}
                      onClick={() => saveEdit(item)}
                    >
                      {t('common.save')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-small"
                      onClick={() => setEditingId(null)}
                    >
                      {t('common.cancel')}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="tl-head">
                    <span className="tl-type">
                      {item.type === 'call' && item.channel === 'whatsapp' ? t('calls.whatsapp') : t(`enums.activityType.${item.type}`)}
                    </span>
                    {item.external ? <span className="badge">Gmail</span> : null}
                    {!item.external && item.type === 'email' && item.direction === 'outbound' ? (
                      <span className="badge">{t('common.sent')}</span>
                    ) : null}
                    {item.pinned ? <span className="badge">{t('common.pinned')}</span> : null}
                    <span className="tl-subject">{item.subject || '—'}</span>
                    <span className="tl-date">
                      {formatWhen(item.due_at ?? item.created_at, locale)}
                    </span>
                  </div>
                  {item.body && (
                    <p className="tl-body">
                      <MentionText text={item.body} people={mentionables} />
                    </p>
                  )}
                  <div className="tl-meta">
                    {item.type === 'task' && item.due_at && (
                      <span>
                        {t('tasks.dueLabel')} {formatDay(item.due_at, locale)}
                      </span>
                    )}
                    {item.direction && <span>{t(`enums.direction.${item.direction}`)}</span>}
                    {item.duration_min != null && <span>{item.duration_min} min</span>}
                    {item.outcome && <span>{isDefaultOutcome(item.outcome) ? t(`calls.outcomes.${item.outcome}`) : item.outcome}</span>}
                    {item.external && item.from_email && (
                      <span className="tl-from">{item.from_email}</span>
                    )}
                    {!item.external && item.type === 'meeting' && zoomOn && !/zoom\.us\//.test(item.body) && (
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => createZoom(item.id)}
                        disabled={zoomBusy !== null}
                        aria-busy={zoomBusy === item.id || undefined}
                      >
                        {t('apps.zoom.createLink')}
                      </button>
                    )}
                    {!item.external && item.type === 'task' && (
                      <button type="button" className="icon-btn" onClick={() => toggleDone(item)}>
                        {item.done ? t('tasks.reopen') : t('tasks.complete')}
                      </button>
                    )}
                    {!item.external && (
                      <>
                        <button
                          type="button"
                          className={`icon-btn tl-pin${item.pinned ? ' is-pinned' : ''}`}
                          onClick={() => togglePin(item)}
                          title={item.pinned ? t('common.unpin') : t('common.pin')}
                          aria-label={item.pinned ? t('common.unpin') : t('common.pin')}
                          aria-pressed={!!item.pinned}
                        >
                          <CrmIcon name="pin" />
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => startEdit(item)}
                          title={t('common.edit')}
                          aria-label={t('common.edit')}
                        >
                          <CrmIcon name="edit" />
                        </button>
                        {confirmId === item.id ? (
                          <>
                            <button
                              type="button"
                              className="icon-btn danger"
                              onClick={() => remove(item.id)}
                            >
                              {t('common.yes')}
                            </button>
                            <button type="button" className="icon-btn" onClick={() => setConfirmId(null)}>
                              {t('common.no')}
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="icon-btn danger"
                            onClick={() => setConfirmId(item.id)}
                            title={t('common.delete')}
                            aria-label={t('common.delete')}
                          >
                            <CrmIcon name="x" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  {!item.external && (
                    <FilesPanel compact endpoint={`/api/crm/activities/${item.id}/files`} files={item.files ?? []} />
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
