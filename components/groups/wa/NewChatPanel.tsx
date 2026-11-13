'use client';

import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { formatPhone } from '@/components/inbox/wa/util';
import { looksLikePhone, parseNewChatPhone } from '@/lib/groups-new-chat-shared';
import { newChatLetter, type NewChatDirectory, type NewChatEntry } from '@/lib/wa-new-chat';
import Avatar from './Avatar';
import { ArrowLeft, CheckIcon, Close, Plus, Search } from './icons';

/** Espera entre la última tecla y la búsqueda. */
const SEARCH_DELAY_MS = 250;

/** Una acción arriba de la lista ("Grupo nuevo", "Correo nuevo"): un link o algo que pasa en la pantalla. */
export interface NewChatAction {
  key: string;
  label: string;
  icon: ReactNode;
  href?: string;
  /** "group": en este panel, elegir participantes y ponerle nombre (Inbox). */
  onSelect?: () => void;
  group?: boolean;
}

export interface NewChatPanelProps {
  open: boolean;
  onClose: () => void;
  /** Cambia cuando cambia de dónde salen los contactos (otra línea): se recarga. */
  sourceKey: string;
  load: (p: { q: string; cursor: string | null; signal: AbortSignal }) => Promise<NewChatDirectory | null>;
  /** Abrir el chat con esa fila. Devuelve el texto del error, o null si se abrió. */
  onPick: (e: NewChatEntry) => Promise<string | null>;
  /** Abrir el chat con un número escrito a mano. */
  onPhone: (phone: string) => Promise<string | null>;
  /** Se pueden empezar chats nuevos (la línea o la cuenta está conectada). */
  canStart: boolean;
  /** Arriba del buscador: el selector de línea. */
  header?: ReactNode;
  /** Aviso arriba de la lista (línea desconectada). */
  notice?: ReactNode;
  actions: NewChatAction[];
  /** Crear un grupo acá mismo (Inbox): con esto, la acción `group` abre la elección de participantes. */
  createGroup?: (name: string, phones: string[]) => Promise<string | null>;
}

type Mode = 'chat' | 'pick' | 'name';

type Option =
  | { kind: 'action'; id: string; action: NewChatAction }
  | { kind: 'direct'; id: string; phone: string }
  | { kind: 'entry'; id: string; entry: NewChatEntry; section: 'self' | 'frequent' | 'contacts' };

/**
 * "Chat nuevo" como el de WhatsApp Web, para Lines e Inbox: buscador, las
 * acciones (grupo nuevo…), "Mandate un mensaje", los contactados con
 * frecuencia y todos los contactos en orden alfabético con su letra. La lista
 * se carga de a páginas al llegar al final. Teclado: ↑/↓ recorren, Enter abre,
 * Esc cierra. En el teléfono ocupa la pantalla.
 */
export default function NewChatPanel(props: NewChatPanelProps) {
  const { open, onClose, sourceKey, load, onPick, onPhone, canStart, header, notice, actions, createGroup } = props;
  const t = useTranslations('inboxWa.newChat');
  const uid = useId().replace(/:/g, '');
  const ref = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>('chat');
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [dir, setDir] = useState<NewChatDirectory | null>(null);
  const [contacts, setContacts] = useState<NewChatEntry[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [tried, setTried] = useState(false);
  const [active, setActive] = useState(0);
  const [picked, setPicked] = useState<Map<string, NewChatEntry>>(new Map());
  const [groupName, setGroupName] = useState('');
  const seq = useRef(0);
  const pointer = useRef('');
  const moreAbort = useRef<AbortController | null>(null);

  // Abrir y cerrar el <dialog>; al abrir, todo de cero y el foco en el buscador.
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setMode('chat');
      setText('');
      setQuery('');
      setError('');
      setTried(false);
      setActive(0);
      setPicked(new Map());
      setGroupName('');
      d.showModal();
      requestAnimationFrame(() => inputRef.current?.focus());
    }
    if (!open && d.open) d.close();
  }, [open]);

  // La búsqueda espera a que se deje de escribir.
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => setQuery(text.trim()), SEARCH_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [text, open]);

  // Primera página (al abrir, al cambiar la búsqueda o la línea).
  const reload = useCallback(() => {
    const mine = ++seq.current;
    moreAbort.current?.abort();
    const ctrl = new AbortController();
    setLoadError(false);
    setMore(false);
    void load({ q: query, cursor: null, signal: ctrl.signal }).then((r) => {
      // Una respuesta vieja (se siguió escribiendo o se cambió de línea) no pisa la nueva.
      if (mine !== seq.current) return;
      if (!r) {
        setDir(null);
        setContacts([]);
        setNext(null);
        setLoadError(true);
        return;
      }
      setDir(r);
      setContacts(r.contacts);
      setNext(r.next);
      setActive(0);
    });
    return ctrl;
  }, [load, query]);

  // Al abrir o cambiar de línea, el esqueleto; al buscar, la lista anterior queda hasta que llega la nueva.
  const shownFor = useRef('');
  useEffect(() => {
    if (!open) shownFor.current = '';
    if (!open || !sourceKey) return;
    if (shownFor.current !== sourceKey) {
      shownFor.current = sourceKey;
      setDir(null);
    }
    const ctrl = reload();
    return () => ctrl.abort();
  }, [open, sourceKey, reload]);

  const loadMore = useCallback(() => {
    if (!next || more) return;
    const mine = seq.current;
    const ctrl = new AbortController();
    moreAbort.current = ctrl;
    setMore(true);
    void load({ q: query, cursor: next, signal: ctrl.signal }).then((r) => {
      if (mine !== seq.current || ctrl.signal.aborted) return;
      setMore(false);
      if (!r) return;
      setContacts((xs) => {
        const seen = new Set(xs.map((x) => x.key));
        return [...xs, ...r.contacts.filter((x) => !seen.has(x.key))];
      });
      setNext(r.next);
    });
  }, [next, more, load, query]);

  // Al llegar al final de la lista, la página que sigue.
  useEffect(() => {
    const el = endRef.current;
    const root = listRef.current;
    if (!open || !el || !root || !next) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && loadMore(), { root, rootMargin: '400px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [open, next, loadMore, contacts.length]);

  const typed = useMemo(() => (looksLikePhone(text) ? parseNewChatPhone(text) : null), [text]);
  const settled = query === text.trim();
  const searching = !!query;
  const shown = useMemo(() => [...(dir?.self ? [dir.self] : []), ...(dir?.frequent ?? []), ...contacts], [dir, contacts]);
  // El número escrito ya está entre los resultados: no se ofrece dos veces.
  const direct = mode === 'chat' && typed?.ok && canStart && !shown.some((r) => r.phone === typed.phone) ? typed.phone : '';
  const phoneHint = mode === 'chat' && typed && !typed.ok && typed.error !== 'not_a_phone' ? typed.error : null;

  const options = useMemo<Option[]>(() => {
    const out: Option[] = [];
    let i = 0;
    const id = () => `${uid}-o${i++}`;
    if (mode === 'chat') {
      if (!searching) for (const a of actions) out.push({ kind: 'action', id: id(), action: a });
      if (direct) out.push({ kind: 'direct', id: id(), phone: direct });
      if (dir?.self) out.push({ kind: 'entry', id: id(), entry: dir.self, section: 'self' });
      if (!searching) for (const e of dir?.frequent ?? []) out.push({ kind: 'entry', id: id(), entry: e, section: 'frequent' });
    }
    if (mode !== 'name') for (const e of contacts) if (mode === 'chat' || e.phone) out.push({ kind: 'entry', id: id(), entry: e, section: 'contacts' });
    return out;
  }, [uid, mode, searching, actions, direct, dir, contacts]);

  const current = options[Math.min(active, options.length - 1)];

  useEffect(() => {
    if (current) document.getElementById(current.id)?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  async function run(fn: () => Promise<string | null>, key: string) {
    if (busy) return;
    setBusy(key);
    setError('');
    const err = await fn();
    setBusy('');
    if (err) setError(err);
  }

  function choose(o: Option) {
    if (o.kind === 'action') {
      if (o.action.group && createGroup) {
        setMode('pick');
        setText('');
        setQuery('');
        setActive(0);
        inputRef.current?.focus();
        return;
      }
      if (o.action.href) return; // el link navega solo (clic) o con Enter (abajo)
      o.action.onSelect?.();
      return;
    }
    if (o.kind === 'direct') return void run(() => onPhone(o.phone), 'direct');
    if (mode === 'pick') {
      setPicked((m) => {
        const n = new Map(m);
        if (n.has(o.entry.key)) n.delete(o.entry.key);
        else n.set(o.entry.key, o.entry);
        return n;
      });
      return;
    }
    if (!o.entry.chatId && !canStart) return;
    void run(() => onPick(o.entry), o.entry.key);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!options.length) return;
      const n = e.key === 'ArrowDown' ? Math.min(active + 1, options.length - 1) : Math.max(active - 1, 0);
      setActive(n);
      if (e.key === 'ArrowDown' && n >= options.length - 5) loadMore();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      setTried(true);
      if (mode === 'name') return void submitGroup();
      if (!current || (!settled && current.kind === 'entry')) return;
      if (current.kind === 'action' && current.action.href) {
        document.getElementById(current.id)?.click();
        return;
      }
      choose(current);
    }
  }

  function submitGroup() {
    const name = groupName.trim();
    if (!name || !createGroup || picked.size === 0) return;
    void run(() => createGroup(name, [...picked.values()].map((p) => p.phone)), 'group');
  }

  const title = mode === 'chat' ? t('title') : mode === 'pick' ? t('addMembers') : t('groupTitle');
  const back = () => {
    setError('');
    setActive(0);
    setMode(mode === 'name' ? 'pick' : 'chat');
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  // El puntero marca la fila solo si se movió de verdad: al desplazar con las flechas, Chrome manda un mousemove
  // sin movimiento y la fila bajo el puntero le robaría la marca al teclado.
  const hover = (ev: React.MouseEvent, o: Option) => {
    const at = `${ev.clientX},${ev.clientY}`;
    if (pointer.current === at) return;
    pointer.current = at;
    if (current?.id !== o.id) setActive(options.indexOf(o));
  };
  // Un clic en una fila no saca el foco del buscador (las flechas y Enter siguen andando).
  const keepFocus = (ev: React.MouseEvent) => ev.preventDefault();

  const subtitle = (e: NewChatEntry) => {
    if (e.about) return e.about;
    const phone = e.phone ? formatPhone(e.phone) : e.phoneLabel;
    return phone && phone !== e.name ? phone : '';
  };
  const displayName = (e: NewChatEntry) => (e.phone && e.name === e.phoneLabel ? formatPhone(e.phone) : e.name);

  const entryRow = (o: Extract<Option, { kind: 'entry' }>) => {
    const e = o.entry;
    const selected = mode === 'pick' && picked.has(e.key);
    const disabled = mode === 'chat' && !e.chatId && !canStart;
    const name = o.section === 'self' ? t('selfName', { name: displayName(e) }) : displayName(e);
    const sub = o.section === 'self' ? t('selfHelp') : subtitle(e);
    return (
      <div
        key={o.id}
        id={o.id}
        role="option"
        aria-selected={current?.id === o.id}
        aria-checked={mode === 'pick' ? selected : undefined}
        aria-disabled={disabled || undefined}
        aria-busy={busy === e.key || undefined}
        className={`wa-nc-row${current?.id === o.id ? ' is-active' : ''}${selected ? ' is-picked' : ''}`}
        onMouseMove={(ev) => hover(ev, o)}
        onMouseDown={keepFocus}
        onClick={() => !disabled && choose(o)}
      >
        <span className="wa-nc-avatar">
          <Avatar name={e.name} kind="dm" src={e.pictureUrl || undefined} size={40} seed={e.phone || e.key} />
          {selected && (
            <span className="wa-nc-check" aria-hidden="true">
              <CheckIcon size={12} />
            </span>
          )}
        </span>
        <span className="wa-nc-text">
          <span className="wa-nc-name">{name}</span>
          {sub && <span className="wa-nc-sub">{sub}</span>}
        </span>
      </div>
    );
  };

  // Contactos con su letra (A, B, …, #): un grupo por letra.
  const contactGroups = useMemo(() => {
    const groups: Array<{ letter: string; rows: Array<Extract<Option, { kind: 'entry' }>> }> = [];
    for (const o of options) {
      if (o.kind !== 'entry' || o.section !== 'contacts') continue;
      const letter = newChatLetter(o.entry.name);
      const last = groups[groups.length - 1];
      if (last && last.letter === letter) last.rows.push(o);
      else groups.push({ letter, rows: [o] });
    }
    return groups;
  }, [options]);

  const loading = !dir && !loadError;
  const top = options.filter((o) => o.kind === 'action' || o.kind === 'direct');
  const self = options.find((o): o is Extract<Option, { kind: 'entry' }> => o.kind === 'entry' && o.section === 'self');
  const frequent = options.filter((o): o is Extract<Option, { kind: 'entry' }> => o.kind === 'entry' && o.section === 'frequent');
  const listLabel = mode === 'pick' ? t('addMembers') : searching ? t('results') : t('contacts');

  return (
    <dialog
      ref={ref}
      className="ui-drawer wa-nc"
      aria-labelledby={open ? `${uid}-title` : undefined}
      aria-modal="true"
      data-testid="new-chat-panel"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      {open && (
        <>
          <div className="ui-drawer-head wa-nc-head">
            {mode !== 'chat' && (
              <button type="button" className="wa-icon-btn wa-nc-back" onClick={back} aria-label={t('back')} title={t('back')}>
                <ArrowLeft size={20} />
              </button>
            )}
            <h2 className="ui-drawer-title wa-nc-title" id={`${uid}-title`}>
              {title}
            </h2>
            <button type="button" className="wa-icon-btn wa-nc-close" onClick={onClose} aria-label={t('close')} title={t('close')}>
              <Close size={20} />
            </button>
          </div>
          {mode === 'chat' && header && <div className="wa-nc-header">{header}</div>}
          {mode === 'name' ? (
            <div className="wa-nc-body wa-nc-name-step">
              <label className="ui-field">
                <span className="label">{t('groupName')}</span>
                <input
                  ref={inputRef}
                  className="input"
                  value={groupName}
                  maxLength={100}
                  autoComplete="off"
                  onChange={(e) => setGroupName(e.target.value)}
                  onKeyDown={onKeyDown}
                />
              </label>
              <p className="ui-help">{t('groupMembers', { n: picked.size })}</p>
              {error && (
                <p className="ui-error" role="alert">
                  {error}
                </p>
              )}
              <div className="wa-nc-foot">
                <button type="button" className="btn btn-primary" onClick={submitGroup} disabled={!groupName.trim() || !!busy} aria-busy={busy === 'group' || undefined}>
                  {t('createGroup')}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="wa-nc-search">
                <span className="wa-nc-search-icon" aria-hidden="true">
                  <Search size={16} />
                </span>
                <input
                  ref={inputRef}
                  className="input wa-nc-input"
                  type="search"
                  role="combobox"
                  aria-label={t('search')}
                  aria-expanded="true"
                  aria-controls={`${uid}-list`}
                  aria-activedescendant={current?.id}
                  aria-autocomplete="list"
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    setError('');
                    setTried(false);
                    setActive(0);
                  }}
                  onKeyDown={onKeyDown}
                  placeholder={t('placeholder')}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              {mode === 'pick' && picked.size > 0 && (
                <ul className="wa-nc-chips" aria-label={t('picked')}>
                  {[...picked.values()].map((p) => (
                    <li key={p.key}>
                      <button
                        type="button"
                        className="wa-nc-chip"
                        onClick={() =>
                          setPicked((m) => {
                            const n = new Map(m);
                            n.delete(p.key);
                            return n;
                          })
                        }
                        aria-label={t('unpick', { name: displayName(p) })}
                      >
                        <span>{displayName(p)}</span>
                        <Close size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {notice}
              {phoneHint && (
                <p className={`wa-nc-msg ${tried || phoneHint === 'too_long' ? 'ui-error' : 'ui-help'}`} role={tried || phoneHint === 'too_long' ? 'alert' : 'status'}>
                  {t(phoneHint === 'too_long' ? 'tooLong' : 'tooShort')}
                </p>
              )}
              {error && (
                <p className="wa-nc-msg ui-error" role="alert">
                  {error}
                </p>
              )}
              <div className="wa-nc-list" ref={listRef} role="listbox" id={`${uid}-list`} aria-label={listLabel} aria-multiselectable={mode === 'pick' || undefined}>
                {top.length > 0 && (
                  <div role="group" className="wa-nc-card" aria-label={t('actions')}>
                    {top.map((o) =>
                      o.kind === 'action' ? (
                        o.action.href ? (
                          <Link
                            key={o.id}
                            id={o.id}
                            href={o.action.href}
                            role="option"
                            aria-selected={current?.id === o.id}
                            className={`wa-nc-row wa-nc-action${current?.id === o.id ? ' is-active' : ''}`}
                            onMouseMove={(ev) => hover(ev, o)}
                            onMouseDown={keepFocus}
                            onClick={onClose}
                            tabIndex={-1}
                          >
                            <span className="wa-nc-icon" aria-hidden="true">
                              {o.action.icon}
                            </span>
                            <span className="wa-nc-name">{o.action.label}</span>
                          </Link>
                        ) : (
                          <div
                            key={o.id}
                            id={o.id}
                            role="option"
                            aria-selected={current?.id === o.id}
                            className={`wa-nc-row wa-nc-action${current?.id === o.id ? ' is-active' : ''}`}
                            onMouseMove={(ev) => hover(ev, o)}
                            onMouseDown={keepFocus}
                            onClick={() => choose(o)}
                          >
                            <span className="wa-nc-icon" aria-hidden="true">
                              {o.action.icon}
                            </span>
                            <span className="wa-nc-name">{o.action.label}</span>
                          </div>
                        )
                      ) : o.kind === 'direct' ? (
                        <div
                          key={o.id}
                          id={o.id}
                          role="option"
                          aria-selected={current?.id === o.id}
                          aria-busy={busy === 'direct' || undefined}
                          className={`wa-nc-row wa-nc-action${current?.id === o.id ? ' is-active' : ''}`}
                          onMouseMove={(ev) => hover(ev, o)}
                            onMouseDown={keepFocus}
                          onClick={() => choose(o)}
                        >
                          <span className="wa-nc-icon is-ink" aria-hidden="true">
                            <Plus size={18} />
                          </span>
                          <span className="wa-nc-text">
                            <span className="wa-nc-name">{t('message', { phone: formatPhone(o.phone) })}</span>
                            <span className="wa-nc-sub">{t('messageHelp')}</span>
                          </span>
                        </div>
                      ) : null,
                    )}
                  </div>
                )}
                {loading ? (
                  <div className="wa-nc-skeleton" role="status" aria-label={t('loading')}>
                    {Array.from({ length: 6 }, (_, i) => (
                      <div key={i} className="wa-nc-row">
                        <span className="ui-skeleton wa-nc-sk-avatar" />
                        <span className="ui-skeleton wa-nc-sk-line" />
                      </div>
                    ))}
                  </div>
                ) : loadError ? (
                  <div className="wa-nc-msg">
                    <p className="ui-error" role="alert">
                      {t('loadError')}
                    </p>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => reload()}>
                      {t('retry')}
                    </button>
                  </div>
                ) : (
                  <>
                    {self && (
                      <div role="group" aria-label={t('selfSection')}>
                        {entryRow(self)}
                      </div>
                    )}
                    {frequent.length > 0 && (
                      <div role="group" aria-labelledby={`${uid}-freq`}>
                        <p className="wa-nc-section" id={`${uid}-freq`}>
                          {t('frequent')}
                        </p>
                        {frequent.map(entryRow)}
                      </div>
                    )}
                    {contactGroups.length > 0 && !searching && (
                      <p className="wa-nc-section" aria-hidden="true">
                        {t('contacts')}
                      </p>
                    )}
                    {searching && contactGroups.length > 0 && (
                      <p className="wa-nc-section" aria-hidden="true">
                        {t('results')}
                      </p>
                    )}
                    {contactGroups.map((g) => (
                      <Fragment key={`${g.letter}-${g.rows[0].id}`}>
                        <div role="group" aria-label={g.letter}>
                          <p className="wa-nc-letter" aria-hidden="true">
                            {g.letter}
                          </p>
                          {g.rows.map(entryRow)}
                        </div>
                      </Fragment>
                    ))}
                    {contactGroups.length === 0 && !self && !direct && !phoneHint && (
                      <p className="wa-nc-msg ui-help" role="status">
                        {searching ? (settled ? t('noResults') : t('loading')) : t('empty')}
                      </p>
                    )}
                    {next && (
                      <div ref={endRef} className="wa-nc-more" role="status">
                        {more ? t('loading') : ''}
                      </div>
                    )}
                  </>
                )}
              </div>
              {mode === 'pick' && (
                <div className="wa-nc-foot">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={picked.size === 0}
                    onClick={() => {
                      setMode('name');
                      setActive(0);
                      requestAnimationFrame(() => inputRef.current?.focus());
                    }}
                  >
                    {t('next')}
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </dialog>
  );
}
