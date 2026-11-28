'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import BookMeetingMenu from './BookMeetingMenu';
import CrmIcon, { type CrmIconName } from './CrmIcon';
import { useCrmPersonId } from './CrmViewer';
import { isQueuedResponse, announceQueued } from '@/lib/offline-queue';
import type { Mentionable } from '@/lib/crm-mentions';
import { NOTE_MD_MAX, noteMarkdownToText } from '@/lib/crm-note-format';
import NoteEditor from './RichNote';

export type PreviewRecordType = 'contact' | 'company' | 'deal' | 'lead';
type ComposeKind = 'note' | 'email' | 'call' | 'task';

const KINDS: ComposeKind[] = ['note', 'email', 'call', 'task'];
const ICON: Record<ComposeKind | 'meeting', CrmIconName> = {
  note: 'note',
  email: 'mail',
  call: 'phone',
  task: 'task',
  meeting: 'calendar',
};

interface PreviewActionsProps {
  type: PreviewRecordType;
  id: string;
  locale: string;
  /** Destinatario del email (el contacto, o el primer contacto del deal). */
  emailTo?: string;
  /** Pre-fill de la reserva de reunión. */
  meetingName?: string;
  meetingEmail?: string;
  /** Después de registrar algo (la vista previa recarga la actividad reciente). */
  onLogged: () => void;
}

/**
 * Acciones rápidas de la vista previa, como la fila de HubSpot: Nota, Email,
 * Llamada, Tarea y Reunión. Las cuatro primeras abren un composer corto acá
 * mismo y guardan por las mismas rutas que el timeline de la ficha
 * (POST /api/crm/activities y /api/crm/emails), con los mismos permisos.
 * Reunión es el menú de links de reserva.
 */
export default function PreviewActions({ type, id, locale, emailTo = '', meetingName, meetingEmail, onLogged }: PreviewActionsProps) {
  const t = useTranslations('crm');
  const personId = useCrmPersonId();
  const formId = useId();
  const [kind, setKind] = useState<ComposeKind | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [to, setTo] = useState(emailTo);
  const [due, setDue] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const firstRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // Personas para @mencionar en la nota (se piden la primera vez que se abre una nota).
  const [people, setPeople] = useState<Mentionable[] | null>(null);
  useEffect(() => {
    if (kind !== 'note' || people) return;
    let alive = true;
    fetch('/api/crm/mentionables')
      .then((r) => (r.ok ? (r.json() as Promise<{ people: Mentionable[] }>) : { people: [] }))
      .then((d) => alive && setPeople(d.people))
      .catch(() => alive && setPeople([]));
    return () => {
      alive = false;
    };
  }, [kind, people]);
  const triggerRefs = useRef<Partial<Record<ComposeKind, HTMLButtonElement | null>>>({});

  useEffect(() => {
    if (kind) firstRef.current?.focus();
  }, [kind]);

  function open(k: ComposeKind) {
    setNotice(null);
    setError(null);
    if (kind === k) {
      close();
      return;
    }
    setKind(k);
    setSubject('');
    setBody('');
    setDue('');
    setTo(emailTo);
  }

  function close() {
    const was = kind;
    setKind(null);
    setError(null);
    if (was) triggerRefs.current[was]?.focus();
  }

  const canSubmit =
    !posting &&
    (kind === 'note'
      ? body.trim() !== '' && body.length <= NOTE_MD_MAX
      : kind === 'call'
      ? body.trim() !== ''
      : kind === 'task'
        ? subject.trim() !== ''
        : kind === 'email'
          ? to.trim() !== '' && subject.trim() !== '' && body.trim() !== ''
          : false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!kind || !canSubmit) return;
    setPosting(true);
    setError(null);
    let res: Response | null;
    if (kind === 'email') {
      res = await fetch('/api/crm/emails', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recordType: type, recordId: id, to: to.trim(), subject: subject.trim(), body: body.trim() }),
      }).catch(() => null);
    } else {
      const payload: Record<string, unknown> = {
        type: kind,
        [`${type}Id`]: id,
        body: body.trim() || undefined,
        subject: kind === 'note' ? undefined : subject.trim() || undefined,
      };
      // La nota se escribe con formato (C1), como en el timeline de la ficha.
      if (kind === 'note') payload.bodyFormat = 'md';
      if (personId) payload.ownerId = personId;
      if (kind === 'task' && due) payload.dueAt = due;
      res = await fetch('/api/crm/activities', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => null);
    }
    setPosting(false);
    if (isQueuedResponse(res)) {
      announceQueued(kind === 'email' ? '/api/crm/emails' : '/api/crm/activities');
      setNotice(t('offline.savedOffline'));
      close();
      return;
    }
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as { error?: string } | null;
      const code = data?.error;
      setError(code && t.has(`errors.${code}`) ? t(`errors.${code}` as 'errors.generic') : t('errors.generic'));
      return;
    }
    setNotice(t(`previewActions.logged.${kind}`));
    close();
    onLogged();
  }

  function keys(e: React.KeyboardEvent<HTMLFormElement>) {
    // El editor de la nota ya usó la tecla (cerrar el menú de @, ⌘↵): no se repite.
    if (e.defaultPrevented) return;
    if (e.key === 'Escape') {
      // Cierra el composer, no la vista previa.
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit(e);
    }
  }

  return (
    <div className="preview-quick-wrap">
      <div className="rec-quick preview-quick" role="group" aria-label={t('record.quickActions')}>
        {/* El email se registra en contactos, empresas y deals; el lead (como su timeline) anota, llama y agenda tareas. */}
        {KINDS.filter((k) => !(type === 'lead' && k === 'email')).map((k) => (
          <button
            key={k}
            ref={(el) => {
              triggerRefs.current[k] = el;
            }}
            type="button"
            className={`btn btn-secondary btn-sm rec-quick-btn${kind === k ? ' is-active' : ''}`}
            aria-expanded={kind === k}
            aria-controls={kind === k ? formId : undefined}
            data-testid={`preview-quick-${k}`}
            onClick={() => open(k)}
          >
            <CrmIcon name={ICON[k]} size={16} />
            <span>{t(`enums.activityType.${k}`)}</span>
          </button>
        ))}
        <BookMeetingMenu
          name={meetingName}
          email={meetingEmail}
          locale={locale}
          triggerClassName="btn btn-secondary btn-sm rec-quick-btn"
          triggerContent={
            <>
              <CrmIcon name={ICON.meeting} size={16} />
              <span>{t('enums.activityType.meeting')}</span>
            </>
          }
        />
      </div>

      {kind && (
        <form ref={formRef} id={formId} className="preview-composer" onSubmit={submit} onKeyDown={keys} data-testid="preview-composer" aria-label={t(`previewActions.title.${kind}`)}>
          <p className="preview-composer-title">{t(`previewActions.title.${kind}`)}</p>
          {kind === 'email' && (
            <label className="preview-composer-field">
              <span>{t('previewActions.to')}</span>
              <input ref={firstRef} className="input" type="email" value={to} onChange={(e) => setTo(e.target.value)} autoComplete="off" />
            </label>
          )}
          {(kind === 'email' || kind === 'task') && (
            <label className="preview-composer-field">
              <span>{kind === 'task' ? t('previewActions.taskTitle') : t('previewActions.subject')}</span>
              <input
                ref={kind === 'task' ? firstRef : undefined}
                className="input"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={200}
                data-testid="preview-composer-subject"
              />
            </label>
          )}
          {kind === 'task' && (
            <label className="preview-composer-field">
              <span>{t('tasks.form.dueAt')}</span>
              <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </label>
          )}
          {kind === 'note' ? (
            <div className="preview-composer-field">
              <span>{t('previewActions.body.note')}</span>
              <NoteEditor
                value={body}
                onChange={setBody}
                people={people ?? []}
                ariaLabel={t('previewActions.body.note')}
                testId="preview-composer-body"
                onSubmit={() => formRef.current?.requestSubmit()}
                onEscape={close}
                autoFocus
              />
              {body.length > NOTE_MD_MAX && <p className="ui-error">{t('timeline.noteTooLong')}</p>}
            </div>
          ) : (
          <label className="preview-composer-field">
            <span>{kind === 'task' ? t('previewActions.taskNotes') : t(`previewActions.body.${kind}`)}</span>
            <textarea
              ref={kind === 'call' ? firstRef : undefined}
              className="input preview-composer-body"
              rows={kind === 'task' ? 2 : 4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              data-testid="preview-composer-body"
            />
          </label>
          )}
          {error && (
            <p className="ui-error" role="alert">
              {error}
            </p>
          )}
          <div className="preview-composer-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={close}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={!canSubmit} data-testid="preview-composer-save">
              {posting ? t('common.saving') : kind === 'email' ? t('previewActions.send') : t('previewActions.save')}
            </button>
          </div>
        </form>
      )}
      {notice && (
        <p className="ui-help preview-notice" role="status">
          {notice}{' '}
          <Link href={`/app/crm/${type === 'contact' ? 'contacts' : type === 'company' ? 'companies' : type === 'lead' ? 'leads' : 'deals'}/${id}?tab=activity`}>
            {t('previewActions.viewActivity')}
          </Link>
        </p>
      )}
    </div>
  );
}

/** Una actividad del timeline de la ficha, como la devuelve GET /api/crm/timeline. */
export interface RecentItem {
  id: string;
  type: string;
  subject: string;
  body: string;
  created_at: string;
  due_at: string | null;
  done: 0 | 1;
  body_format?: 'text' | 'md';
}

function when(value: string, locale: string): string {
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d);
}

const RECENT_ICON: Record<string, CrmIconName> = { note: 'note', email: 'mail', call: 'phone', task: 'task', meeting: 'calendar', whatsapp: 'message' };

/** Las últimas actividades del registro (las mismas que la ficha muestra a esta persona). */
export function RecentActivity({ items, locale, href, loading }: { items: RecentItem[] | null; locale: string; href: string; loading: boolean }) {
  const t = useTranslations('crm');
  if (loading && !items) return <p className="muted preview-empty">{t('record.loading')}</p>;
  if (!items || items.length === 0) return <p className="muted preview-empty">{t('previewActions.noActivity')}</p>;
  return (
    <>
      <ul className="preview-recent" data-testid="preview-recent">
        {items.map((it) => {
          const text = (it.subject || (it.body_format === 'md' ? noteMarkdownToText(it.body) : it.body) || '').replace(/\s+/g, ' ').trim();
          return (
            <li key={it.id} className="preview-recent-item">
              <span className="preview-recent-icon" aria-hidden="true">
                <CrmIcon name={RECENT_ICON[it.type] ?? 'note'} size={14} />
              </span>
              <span className="preview-recent-main">
                <span className="preview-recent-type">
                  {t.has(`enums.activityType.${it.type}`) ? t(`enums.activityType.${it.type}`) : it.type}
                  {it.type === 'task' && it.done ? ` · ${t('previewActions.done')}` : ''}
                </span>
                {text && <span className="preview-recent-text">{text.length > 120 ? `${text.slice(0, 120)}…` : text}</span>}
              </span>
              <time className="preview-recent-when">{when(it.created_at, locale)}</time>
            </li>
          );
        })}
      </ul>
      <Link href={href} className="preview-recent-all">
        {t('previewActions.viewActivity')}
      </Link>
    </>
  );
}
