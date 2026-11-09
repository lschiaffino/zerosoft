'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { FOLDER_COLORS, SHORTCUTS, type FolderDto, type FolderRule, type InboxAccountDto, type ThreadDto } from '@/lib/inbox/types';
import { api } from './api';
import { canMoveFolder, depthOf, flattenTree, MAX_FOLDER_DEPTH } from '@/lib/inbox/folder-tree';

/** Modal (<dialog>): Esc y el telón cierran, el foco queda adentro. */
export function Modal({ open, title, onClose, children, wide = false }: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`ui-modal ib-dialog${wide ? ' ui-modal-wide' : ''}`}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open && (
        <>
          <div className="ui-modal-head">
            <h2 className="ui-modal-title">{title}</h2>
          </div>
          {children}
        </>
      )}
    </dialog>
  );
}

/** Mover a carpeta (V): filtrar escribiendo, Enter elige la primera. Las marcadas se sacan. */
export function MoveDialog({
  open,
  folders,
  current,
  onClose,
  onPick,
  onNewFolder,
}: {
  open: boolean;
  folders: FolderDto[];
  current: string[];
  onClose: () => void;
  onPick: (folderId: string, add: boolean) => void;
  onNewFolder: () => void;
}) {
  const t = useTranslations('inbox.move');
  const [q, setQ] = useState('');
  useEffect(() => {
    if (open) setQ('');
  }, [open]);
  const needle = q.trim().toLowerCase();
  const tree = flattenTree(folders);
  const list = tree.filter(({ folder: f }) => f.name.toLowerCase().includes(needle)).map((r) => r.folder);
  const depthById = new Map(tree.map((r) => [r.folder.id, needle ? 0 : r.depth]));
  return (
    <Modal open={open} title={t('title')} onClose={onClose}>
      <div className="ui-modal-body">
        <label className="sr-only" htmlFor="ib-move-q">
          {t('filter')}
        </label>
        <input
          id="ib-move-q"
          className="input"
          autoFocus
          placeholder={t('filter')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && list[0]) {
              e.preventDefault();
              onPick(list[0].id, !current.includes(list[0].id));
            }
          }}
        />
        {folders.length === 0 ? (
          <p className="ib-help">{t('none')}</p>
        ) : (
          <ul className="ib-pick-list">
            {list.map((f) => {
              const inIt = current.includes(f.id);
              return (
                <li key={f.id}>
                  <button type="button" className="ib-pick" style={{ paddingLeft: 10 + (depthById.get(f.id) ?? 0) * 16 }} onClick={() => onPick(f.id, !inIt)} aria-pressed={inIt}>
                    <span className="ib-swatch" style={{ background: f.color || 'var(--c-inbox)' }} aria-hidden />
                    <span className="ib-pick-name">{f.name}</span>
                    {inIt && <span className="ib-dim">{t('remove')}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="ui-modal-foot">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onNewFolder}>
          {t('newFolder')}
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
          {t('close')}
        </button>
      </div>
    </Modal>
  );
}

export type MoreAction = 'unread' | 'pin' | 'mute8h' | 'muteWeek' | 'unmute' | 'clearFollowUp' | 'unsnooze' | 'aiDraft' | 'delete';

/** Más acciones del chat: leído, fijar, silenciar, quitar recordatorio, sacar de Inbox. */
export function MoreDialog({ open, thread, onClose, onAction, startConfirm = false }: { open: boolean; thread: ThreadDto | null; onClose: () => void; onAction: (a: MoreAction) => void; startConfirm?: boolean }) {
  const t = useTranslations('inbox.more');
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (open) setConfirm(startConfirm);
  }, [open, startConfirm]);
  if (!thread) return null;
  const items: MoreAction[] = [
    'unread',
    'pin',
    'aiDraft',
    ...(thread.mutedUntil ? (['unmute'] as const) : (['mute8h', 'muteWeek'] as const)),
    ...(thread.followUpAt ? (['clearFollowUp'] as const) : []),
    ...(thread.snoozedUntil ? (['unsnooze'] as const) : []),
  ];
  return (
    <Modal open={open} title={thread.title} onClose={onClose}>
      <div className="ui-modal-body">
        {confirm ? (
          <div className="ib-confirm">
            <p>{t('deleteConfirm')}</p>
            <div className="ib-row">
              <button type="button" className="btn btn-secondary btn-sm" autoFocus onClick={() => setConfirm(false)}>
                {t('cancel')}
              </button>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => onAction('delete')}>
                {t('deleteYes')}
              </button>
            </div>
          </div>
        ) : (
          <ul className="ib-pick-list">
            {items.map((a, i) => (
              <li key={a}>
                <button type="button" className="ib-pick" autoFocus={i === 0} onClick={() => onAction(a)}>
                  {a === 'pin' ? (thread.pinned ? t('unpin') : t('pin')) : a === 'unread' ? (thread.unread ? t('read') : t('unread')) : t(a)}
                </button>
              </li>
            ))}
            <li>
              <button type="button" className="ib-pick ib-danger" onClick={() => setConfirm(true)}>
                {t('delete')}
              </button>
            </li>
          </ul>
        )}
      </div>
    </Modal>
  );
}

/** Chat nuevo (número de WhatsApp) o correo nuevo. */
export function ComposeDialog({ open, accounts, onClose, onCreated }: { open: boolean; accounts: InboxAccountDto[]; onClose: () => void; onCreated: (t: ThreadDto) => void }) {
  const t = useTranslations('inbox.compose');
  const te = useTranslations('inbox.errors');
  const wa = accounts.find((a) => a.kind === 'whatsapp' && a.status === 'connected');
  const gmail = accounts.filter((a) => a.kind === 'gmail' && a.status === 'connected');
  const [channel, setChannel] = useState<'whatsapp' | 'gmail'>(wa ? 'whatsapp' : 'gmail');
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (open) {
      setTo('');
      setSubject('');
      setBody('');
      setErr('');
      setChannel(wa ? 'whatsapp' : 'gmail');
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const none = !wa && gmail.length === 0;
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setErr('');
    const r = await api<{ thread: ThreadDto }>('/api/inbox/compose', {
      method: 'POST',
      json: channel === 'whatsapp' ? { channel, to, body: body || undefined } : { channel, to, subject, body, accountId: gmail[0]?.id },
    });
    setBusy(false);
    if (!r.ok) {
      setErr(te.has(r.data.error ?? '') ? te(r.data.error as string) : te('generic'));
      return;
    }
    onCreated(r.data.thread);
  };
  return (
    <Modal open={open} title={t('title')} onClose={onClose}>
      {none ? (
        <div className="ui-modal-body">
          <p>{t('noAccounts')}</p>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="ui-modal-body ib-form">
            {wa && gmail.length > 0 && (
              <div className="ui-tabs ib-tabs" role="tablist" aria-label={t('channel')}>
                {(['whatsapp', 'gmail'] as const).map((c) => (
                  <button key={c} type="button" role="tab" aria-selected={channel === c} className={`ui-tab${channel === c ? ' is-active' : ''}`} onClick={() => setChannel(c)}>
                    {c === 'whatsapp' ? 'WhatsApp' : 'Gmail'}
                  </button>
                ))}
              </div>
            )}
            <div className="ui-field">
              <label className="label" htmlFor="ib-to">
                {channel === 'whatsapp' ? t('phone') : t('to')}
              </label>
              <input id="ib-to" className="input" autoFocus required value={to} maxLength={channel === 'whatsapp' ? 40 : 1000} inputMode={channel === 'whatsapp' ? 'tel' : 'email'} placeholder={channel === 'whatsapp' ? '+54 9 11 5555 0000' : 'ana@example.com'} onChange={(e) => setTo(e.target.value)} />
              {channel === 'whatsapp' && <p className="ui-help">{t('phoneHelp')}</p>}
            </div>
            {channel === 'gmail' && (
              <div className="ui-field">
                <label className="label" htmlFor="ib-subject">
                  {t('subject')}
                </label>
                <input id="ib-subject" className="input" value={subject} maxLength={300} onChange={(e) => setSubject(e.target.value)} />
              </div>
            )}
            <div className="ui-field">
              <label className="label" htmlFor="ib-body">
                {t('message')}
              </label>
              <textarea id="ib-body" className="textarea" rows={5} value={body} maxLength={8000} required={channel === 'gmail'} onChange={(e) => setBody(e.target.value)} />
            </div>
            {err && (
              <p className="ui-error" role="alert">
                {err}
              </p>
            )}
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
              {t('cancel')}
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
              {busy ? t('sending') : channel === 'whatsapp' && !body.trim() ? t('openChat') : t('send')}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/** Atajos de teclado (?). */
export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('inbox.help');
  return (
    <Modal open={open} title={t('title')} onClose={onClose} wide>
      <div className="ui-modal-body">
        <dl className="ib-keys">
          {SHORTCUTS.map((s) => (
            <div key={s.id} className="ib-key-row">
              <dt>
                <span className="kbd">{s.keys}</span>
              </dt>
              <dd>{t(`keys.${s.id}`)}</dd>
            </div>
          ))}
        </dl>
        <p className="ib-help">{t('dictation')}</p>
      </div>
      <div className="ui-modal-foot">
        <button type="button" className="btn btn-secondary btn-sm" autoFocus onClick={onClose}>
          {t('close')}
        </button>
      </div>
    </Modal>
  );
}

/** Crear, renombrar o borrar una carpeta, con su regla (qué chats entran solos). */
export function FolderDialog({
  open,
  folder,
  folders = [],
  parentId: defaultParent = null,
  onClose,
  onSaved,
}: {
  open: boolean;
  folder: FolderDto | null;
  /** Todas las carpetas, para elegir dentro de cuál va (sin ellas no se muestra el campo). */
  folders?: FolderDto[];
  /** Carpeta padre de una nueva ("Nueva subcarpeta"). */
  parentId?: string | null;
  onClose: () => void;
  onSaved: (f: FolderDto | null, deleted?: boolean) => void;
}) {
  const t = useTranslations('inbox.folders');
  const te = useTranslations('inbox.errors');
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(FOLDER_COLORS[0]);
  const [rule, setRule] = useState<FolderRule>({});
  const [parent, setParent] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(folder?.name ?? '');
    setColor(folder?.color || FOLDER_COLORS[0]);
    setRule(folder?.rule ?? {});
    setParent((folder ? folder.parentId : defaultParent) ?? '');
    setErr('');
    setConfirmDelete(false);
  }, [open, folder, defaultParent]);
  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setErr('');
    const cleanRule = rule.channel || rule.kind || rule.from?.trim() ? rule : null;
    const parentId = parent || null;
    const r = folder
      ? await api<{ folders: FolderDto[] }>(`/api/inbox/folders/${folder.id}`, {
          method: 'PATCH',
          json: { name: name.trim(), color, rule: cleanRule, ...(folders.length && parentId !== folder.parentId ? { move: { parentId, before: null } } : {}) },
        })
      : await api<{ folder: FolderDto }>('/api/inbox/folders', { method: 'POST', json: { name: name.trim(), color, rule: cleanRule, parentId } });
    setBusy(false);
    if (!r.ok) {
      setErr(te.has(r.data.error ?? '') ? te(r.data.error as string) : te('generic'));
      return;
    }
    const saved = folder ? ((r.data as { folders: FolderDto[] }).folders.find((f) => f.id === folder.id) ?? null) : (r.data as { folder: FolderDto }).folder;
    onSaved(saved);
  };
  const remove = async () => {
    if (!folder) return;
    setBusy(true);
    const r = await api(`/api/inbox/folders/${folder.id}`, { method: 'DELETE' });
    setBusy(false);
    if (!r.ok) {
      setErr(te('generic'));
      return;
    }
    onSaved(null, true);
  };
  return (
    <Modal open={open} title={folder ? t('editTitle') : t('newTitle')} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="ui-modal-body ib-form">
          <div className="ui-field">
            <label className="label" htmlFor="ib-folder-name">
              {t('name')}
            </label>
            <input id="ib-folder-name" className="input" autoFocus required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          {folders.length > 0 && (
            <div className="ui-field">
              <label className="label" htmlFor="ib-folder-parent">
                {t('parent')}
              </label>
              <select id="ib-folder-parent" className="select" value={parent} onChange={(e) => setParent(e.target.value)}>
                <option value="">{t('topLevel')}</option>
                {flattenTree(folders).map(({ folder: f, depth }) => {
                  const ok = folder ? canMoveFolder(folders, folder.id, f.id) === 'ok' : depthOf(folders, f.id) + 1 <= MAX_FOLDER_DEPTH;
                  return (
                    <option key={f.id} value={f.id} disabled={!ok}>
                      {`${'\u00a0\u00a0'.repeat(depth)}${f.name}`}
                    </option>
                  );
                })}
              </select>
            </div>
          )}
          <fieldset className="ib-fieldset">
            <legend className="label">{t('color')}</legend>
            <div className="ib-swatches">
              {FOLDER_COLORS.map((c) => (
                <label key={c} className={`ib-swatch-pick${color === c ? ' is-on' : ''}`} style={{ background: c }}>
                  <input type="radio" name="ib-color" className="sr-only" value={c} checked={color === c} onChange={() => setColor(c)} />
                  <span className="sr-only">{c}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="ib-fieldset">
            <legend className="label">{t('rule')}</legend>
            <p className="ui-help">{t('ruleHelp')}</p>
            <div className="ib-rule">
              <label className="sr-only" htmlFor="ib-rule-ch">
                {t('ruleChannel')}
              </label>
              <select id="ib-rule-ch" className="select" value={rule.channel ?? ''} onChange={(e) => setRule({ ...rule, channel: (e.target.value || undefined) as FolderRule['channel'] })}>
                <option value="">{t('anyChannel')}</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="gmail">Gmail</option>
              </select>
              <label className="sr-only" htmlFor="ib-rule-kind">
                {t('ruleKind')}
              </label>
              <select id="ib-rule-kind" className="select" value={rule.kind ?? ''} onChange={(e) => setRule({ ...rule, kind: (e.target.value || undefined) as FolderRule['kind'] })}>
                <option value="">{t('anyKind')}</option>
                <option value="dm">{t('kindDm')}</option>
                <option value="group">{t('kindGroup')}</option>
                <option value="email">{t('kindEmail')}</option>
              </select>
              <label className="sr-only" htmlFor="ib-rule-from">
                {t('ruleFrom')}
              </label>
              <input id="ib-rule-from" className="input" placeholder={t('ruleFrom')} maxLength={80} value={rule.from ?? ''} onChange={(e) => setRule({ ...rule, from: e.target.value })} />
            </div>
          </fieldset>
          {err && (
            <p className="ui-error" role="alert">
              {err}
            </p>
          )}
          {confirmDelete && (
            <div className="ib-confirm" role="alert">
              <p>{t('deleteConfirm', { name: folder?.name ?? '' })}</p>
              <div className="ib-row">
                <button type="button" className="btn btn-secondary btn-sm" autoFocus onClick={() => setConfirmDelete(false)}>
                  {t('cancel')}
                </button>
                <button type="button" className="btn btn-danger btn-sm" onClick={() => void remove()} disabled={busy}>
                  {t('deleteYes')}
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="ui-modal-foot">
          {folder && !confirmDelete && (
            <button type="button" className="btn btn-ghost btn-sm ib-danger ib-foot-left" onClick={() => setConfirmDelete(true)}>
              {t('delete')}
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !name.trim()}>
            {folder ? t('save') : t('create')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
