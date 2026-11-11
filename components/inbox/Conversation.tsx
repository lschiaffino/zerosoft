'use client';

import { forwardRef, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { FolderDto, MessageDto, ScheduledDto, SnippetDto, ThreadDto } from '@/lib/inbox/types';
import { avatarHue, longWhen, api } from './api';
import Avatar from '@/components/groups/wa/Avatar';
import { chatName } from './wa/util';
import ScheduledList from './ScheduledList';
import Composer, { type ComposerHandle } from './Composer';
import { useInboxThreadCommands } from './slash-commands';

export interface ThreadDetail {
  thread: ThreadDto;
  messages: MessageDto[];
  more: boolean;
  scheduled: ScheduledDto[];
  /** Mensaje al que ir (resultado de búsqueda). */
  focus?: string;
}

/** Partes de un texto con links clicables (con y sin https://) y emails. */
function linkify(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(https?:\/\/[^\s<]+|www\.[^\s<]+|[\w.+-]+@[\w-]+\.[\w.-]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const raw = m[0].replace(/[).,;:!?]+$/, '');
    const href = raw.includes('@') && !raw.startsWith('http') ? `mailto:${raw}` : raw.startsWith('www.') ? `https://${raw}` : raw;
    out.push(
      <a key={i++} href={href} target="_blank" rel="noopener noreferrer nofollow">
        {raw}
      </a>,
    );
    last = m.index + raw.length;
    re.lastIndex = last;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Separa el texto propio de la parte citada de un correo. */
function splitQuoted(body: string): [string, string] {
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (/^(On|El|Em) .{4,200}(wrote|escribió|escreveu):$/.test(l) || (/^>/.test(l) && i > 0)) {
      return [lines.slice(0, i).join('\n').trim(), lines.slice(i).join('\n')];
    }
  }
  return [body, ''];
}

function Media({ m }: { m: MessageDto }) {
  const t = useTranslations('inbox.message');
  const label = t(`media.${['image', 'video', 'audio', 'document', 'sticker'].includes(m.mediaType) ? m.mediaType : 'document'}`);
  if (!m.hasMedia) return <span className="ib-media-tag">{m.mediaName || label}</span>;
  const src = `/api/inbox/media/${m.id}`;
  if (m.mediaType === 'image' || m.mediaType === 'sticker') {
    return (
      <a href={src} target="_blank" rel="noopener noreferrer" className="ib-media-img">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={m.body || label} loading="lazy" />
      </a>
    );
  }
  if (m.mediaType === 'audio') return <audio className="ib-media-audio" controls preload="none" src={src} aria-label={label} />;
  if (m.mediaType === 'video') return <video className="ib-media-video" controls preload="none" src={src} aria-label={label} />;
  return (
    <a href={src} className="ib-media-doc" download>
      {m.mediaName || label}
    </a>
  );
}

function Bubble({ m, group, email }: { m: MessageDto; group: boolean; email: boolean }) {
  const t = useTranslations('inbox.message');
  const locale = useLocale();
  const [showQuote, setShowQuote] = useState(false);
  const time = new Date(m.sentAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  if (email) {
    const [own, quoted] = splitQuoted(m.body);
    return (
      <article className={`ib-mail${m.fromMe ? ' is-me' : ''}`}>
        <header className="ib-mail-head">
          <strong>{m.fromMe ? t('me') : m.senderName || m.senderHandle}</strong>
          {!m.fromMe && m.senderHandle && m.senderName && <span className="ib-dim"> {m.senderHandle}</span>}
          <span className="ib-dim ib-mail-time">{longWhen(m.sentAt, locale)}</span>
        </header>
        {m.subject && <p className="ib-mail-subject">{m.subject}</p>}
        <div className="ib-mail-body">{linkify(own || m.body)}</div>
        {quoted && (
          <button type="button" className="btn btn-ghost btn-sm ib-quote-toggle" aria-expanded={showQuote} onClick={() => setShowQuote((v) => !v)}>
            {showQuote ? t('hideQuote') : t('showQuote')}
          </button>
        )}
        {quoted && showQuote && <div className="ib-mail-body ib-quoted">{quoted}</div>}
      </article>
    );
  }
  return (
    <div className={`ib-msg${m.fromMe ? ' is-me' : ''}${m.revoked ? ' is-revoked' : ''}`}>
      <div className="ib-bubble">
        {group && !m.fromMe && <span className="ib-sender" style={{ color: `hsl(${avatarHue(m.senderHandle || m.senderName)} 55% 38%)` }}>{m.senderName || m.senderHandle}</span>}
        {m.mediaType && <Media m={m} />}
        {m.body && <p className="ib-text">{linkify(m.body)}</p>}
        <span className="ib-meta">
          {m.revoked && <span className="ib-revoked">{t('revoked')}</span>}
          {m.edited && <span>{t('edited')}</span>}
          <time dateTime={m.sentAt}>{time}</time>
          {m.fromMe && m.status && (
            <span className={`ib-ack ib-ack-${m.status}`} role="img" aria-label={t(`status.${['sent', 'delivered', 'read', 'failed'].includes(m.status) ? m.status : 'sent'}`)}>
              {m.status === 'failed' ? '!' : m.status === 'sent' ? '✓' : '✓✓'}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

function dayLabel(iso: string, locale: string, today: string, yesterday: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return today;
  if (d.toDateString() === new Date(now.getTime() - 86_400_000).toDateString()) return yesterday;
  return d.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

/**
 * Conversación abierta: cabecera con acciones, notas para la IA, mensajes
 * (burbujas como WhatsApp Web, tarjetas en correo), programados y el campo.
 */
const Conversation = forwardRef<
  ComposerHandle,
  {
    detail: ThreadDetail;
    folders: FolderDto[];
    snippets: SnippetDto[];
    connected: boolean;
    /** Se está abriendo otro chat (esta conversación es la anterior hasta que llegue). */
    paused?: boolean;
    onBack: () => void;
    onAction: (action: string) => void;
    onSent: (messages: MessageDto[]) => void;
    onSendLater: (text: string) => void;
    onScheduledChange: () => void;
    onRename: (title: string) => void;
    onError: (code: string) => void;
    loadOlder: () => Promise<void>;
  }
>(function Conversation({ detail, folders, snippets, connected, paused, onBack, onAction, onSent, onSendLater, onScheduledChange, onRename, onError, loadOlder }, composerRef) {
  const t = useTranslations('inbox');
  const locale = useLocale();
  const { thread, messages, scheduled } = detail;
  const scroller = useRef<HTMLDivElement>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [notesState, setNotesState] = useState<'' | 'saving' | 'saved'>('');
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(thread.title);
  const lastId = useRef('');
  const email = thread.channel === 'gmail';
  const group = thread.kind === 'group';
  const w = useTranslations('inboxWa');
  const displayName = chatName(thread, w('group'));

  // Al abrir o al llegar uno nuevo: abajo de todo.
  useLayoutEffect(() => {
    const el = scroller.current;
    const last = messages[messages.length - 1]?.id ?? '';
    if (el && last !== lastId.current) {
      el.scrollTop = el.scrollHeight;
      lastId.current = last;
    }
  }, [messages]);

  // Ir al mensaje buscado: centrado y marcado un momento.
  useEffect(() => {
    if (!detail.focus) return;
    const el = scroller.current?.querySelector<HTMLElement>(`[data-msg="${CSS.escape(detail.focus)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    el.classList.add('ib-msg-hit');
    const id = window.setTimeout(() => el.classList.remove('ib-msg-hit'), 2600);
    return () => window.clearTimeout(id);
  }, [detail.focus, detail.thread.id]);

  useEffect(() => {
    setTitle(thread.title);
    setRenaming(false);
    setNotesOpen(false);
    setNotesState('');
  }, [thread.id, thread.title]);

  // Comandos "/" del campo: las mismas acciones de esta cabecera y de "Más acciones".
  const slashCommands = useInboxThreadCommands({ thread, onAction, openNotes: () => void openNotes(), rename: () => setRenaming(true) });

  const openNotes = async () => {
    if (notesOpen) {
      setNotesOpen(false);
      return;
    }
    const r = await api<{ notes: string }>(`/api/inbox/threads/${thread.id}`);
    setNotes(r.ok ? String(r.data.notes ?? '') : '');
    setNotesOpen(true);
  };

  const saveNotes = async () => {
    setNotesState('saving');
    const r = await api(`/api/inbox/threads/${thread.id}`, { method: 'PATCH', json: { notes } });
    setNotesState(r.ok ? 'saved' : '');
    if (!r.ok) onError(r.data.error ?? 'generic');
  };


  const folderNames = thread.folderIds.map((id) => folders.find((f) => f.id === id)?.name).filter(Boolean) as string[];
  let prevDay = '';

  return (
    <section className="ib-convo" aria-label={thread.title}>
      <header className="ib-convo-head">
        <button type="button" className="btn btn-ghost btn-sm btn-icon ib-back" onClick={onBack} aria-label={t('actions.back')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <Avatar name={displayName} kind={group ? 'group' : 'dm'} src={thread.avatar || undefined} seed={thread.id} size={40} />
        <div className="ib-convo-title">
          {renaming ? (
            <form
              className="ib-row"
              onSubmit={(e) => {
                e.preventDefault();
                if (title.trim()) onRename(title.trim());
                setRenaming(false);
              }}
            >
              <label className="sr-only" htmlFor="ib-rename">
                {t('actions.rename')}
              </label>
              <input
                id="ib-rename"
                className="input"
                value={title}
                maxLength={200}
                autoFocus
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    setTitle(thread.title);
                    setRenaming(false);
                  }
                }}
              />
              <button type="submit" className="btn btn-primary btn-sm">
                {t('actions.save')}
              </button>
            </form>
          ) : (
            <button type="button" className="ib-title-btn" onClick={() => setRenaming(true)} title={t('actions.rename')}>
              <h2 className="ib-h2">{displayName}</h2>
            </button>
          )}
          <p className="ib-sub">
            <span className="ib-chan">{thread.channel === 'gmail' ? 'Gmail' : group ? t('list.group') : 'WhatsApp'}</span>
            {thread.handle && <span className="ib-dim"> {thread.channel === 'whatsapp' ? `+${thread.handle}` : thread.handle}</span>}
            {folderNames.map((n) => (
              <span key={n} className="ib-tag">
                {n}
              </span>
            ))}
            {thread.snoozedUntil && <span className="ib-tag">{t('list.snoozedUntil', { when: longWhen(thread.snoozedUntil, locale) })}</span>}
            {thread.followUpAt && <span className="ib-tag">{t('list.followUpAt', { when: longWhen(thread.followUpAt, locale) })}</span>}
          </p>
        </div>
        <div className="ib-convo-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onAction(thread.done ? 'undone' : 'done')} title={thread.done ? '⇧E' : 'E'}>
            {thread.done ? t('actions.undone') : t('actions.done')}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onAction('snooze')} title="H">
            {t('actions.snooze')}
          </button>
          <button type="button" className="btn btn-ghost btn-sm ib-hide-sm" onClick={() => onAction('followUp')} title="F">
            {t('actions.followUp')}
          </button>
          <button type="button" className="btn btn-ghost btn-sm ib-hide-sm" onClick={() => onAction('move')} title="V">
            {t('actions.move')}
          </button>
          <button type="button" className="btn btn-ghost btn-sm ib-hide-sm" onClick={() => void openNotes()} aria-expanded={notesOpen}>
            {t('actions.notes')}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onAction('more')} aria-label={t('actions.more')} title={t('actions.more')}>
            ⋯
          </button>
        </div>
      </header>
      {notesOpen && (
        <div className="ib-notes">
          <label className="label" htmlFor="ib-notes-text">
            {t('notes.label')}
          </label>
          <p className="ib-help">{t('notes.help')}</p>
          <textarea id="ib-notes-text" className="textarea" rows={5} value={notes} maxLength={20000} onChange={(e) => {
            setNotes(e.target.value);
            setNotesState('');
          }} />
          <div className="ib-row">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void saveNotes()} disabled={notesState === 'saving'}>
              {notesState === 'saving' ? t('notes.saving') : t('notes.save')}
            </button>
            {notesState === 'saved' && <span className="ib-dim">{t('notes.saved')}</span>}
          </div>
        </div>
      )}
      <div className="ib-messages" ref={scroller} tabIndex={-1}>
        {detail.more && (
          <div className="ib-older">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadOlder()}>
              {t('message.older')}
            </button>
          </div>
        )}
        {messages.length === 0 && <p className="ib-empty-convo">{t('message.empty')}</p>}
        {messages.map((m) => {
          const day = new Date(m.sentAt).toDateString();
          const sep = day !== prevDay;
          prevDay = day;
          return (
            <div key={m.id} data-msg={m.id}>
              {sep && (
                <div className="ib-day" role="separator">
                  <span>{dayLabel(m.sentAt, locale, t('message.today'), t('message.yesterday'))}</span>
                </div>
              )}
              <Bubble m={m} group={group} email={email} />
            </div>
          );
        })}
      </div>
      <ScheduledList thread={thread} scheduled={scheduled} connected={connected} onChange={onScheduledChange} onError={onError} />
      <Composer key={thread.id} ref={composerRef} thread={thread} snippets={snippets} disabled={!connected} paused={paused} onSent={onSent} onSendLater={onSendLater} onError={onError} commands={slashCommands} />
    </section>
  );
});

export default Conversation;
