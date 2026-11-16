'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import EmptyState from '@/components/ui/EmptyState';
import { useMounted } from '@/components/ui/useMounted';
import { parseDbUtc } from '@/lib/utils';
import type { ContactHubspot, ContactRowDto, ContactsDto } from '@/lib/groups-contacts';
import type { HubspotSuggestion } from '@/lib/groups-hubspot';
import { Modal, api, useErrorText } from '../dialog-kit';
import Avatar from './Avatar';

/** Una línea (Lines) o cuenta (Inbox) para el filtro y las columnas. */
export interface ContactsLine {
  id: string;
  name: string;
}

type ChatFilter = '' | 'dm' | 'groups';
type HsFilter = '' | 'linked' | 'unlinked';

/** "+54 9 11 5555-0000" (lo enmascarado queda como vino). */
function phoneText(phone: string, masked?: boolean): string {
  if (!phone || masked) return phone;
  // Como la ficha del contacto (ContactSheet): los formatos más comunes, el resto con "+".
  const ar = /^549(11|\d{3})(\d{3,4})(\d{4})$/.exec(phone);
  if (ar) return `+54 9 ${ar[1]} ${ar[2]}-${ar[3]}`;
  const us = /^1(\d{3})(\d{3})(\d{4})$/.exec(phone);
  if (us) return `+1 ${us[1]} ${us[2]} ${us[3]}`;
  const br = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(phone);
  if (br) return `+55 ${br[1]} ${br[2]}-${br[3]}`;
  return `+${phone}`;
}

/** "hace 5 min" en el idioma de la página, recién en el navegador (la zona y el "ahora" son de quien mira). */
function useAgo() {
  const locale = useLocale();
  const mounted = useMounted();
  return useCallback(
    (iso: string | null) => {
      if (!iso || !mounted) return '';
      const at = parseDbUtc(iso).getTime();
      if (!Number.isFinite(at)) return '';
      const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
      const min = Math.round((at - Date.now()) / 60_000);
      if (Math.abs(min) < 60) return rtf.format(min, 'minute');
      const h = Math.round(min / 60);
      if (Math.abs(h) < 24) return rtf.format(h, 'hour');
      const d = Math.round(h / 24);
      if (Math.abs(d) < 7) return rtf.format(d, 'day');
      return new Date(at).toLocaleDateString(locale);
    },
    [locale, mounted],
  );
}

/**
 * Un botón con un menú de una opción: se cierra con un clic o toque afuera,
 * con Esc (el foco vuelve al botón) y al elegir.
 */
function PickMenu<V extends string>({
  label,
  keyText,
  value,
  options,
  onPick,
  testId,
}: {
  label: string;
  keyText: string;
  value: V;
  options: Array<{ value: V; label: string }>;
  onPick: (v: V) => void;
  testId: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      btn.current?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    // El foco entra a la opción elegida (o la primera), como en un menú.
    requestAnimationFrame(() => (box.current?.querySelector<HTMLElement>('[aria-checked="true"]') ?? box.current?.querySelector<HTMLElement>('[role="menuitemradio"]'))?.focus());
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  const current = options.find((o) => o.value === value)?.label ?? '';
  const move = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(box.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
  };
  return (
    <div className="gr-columns wc-pick" ref={box}>
      <button
        ref={btn}
        type="button"
        className={`btn btn-ghost gr-gt-menu-btn${value ? ' is-on' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}: ${current}`}
        data-testid={testId}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="gr-gt-btn-key">{keyText}:</span> <span className="wc-pick-value">{current}</span>
      </button>
      {open && (
        <div className="gr-columns-menu gr-gt-popover wc-menu" role="menu" aria-label={label} onKeyDown={move}>
          {options.map((o) => (
            <button
              key={o.value || 'all'}
              type="button"
              role="menuitemradio"
              aria-checked={o.value === value}
              className="gr-gt-menuitem wc-menuitem"
              onClick={() => {
                onPick(o.value);
                setOpen(false);
                btn.current?.focus();
              }}
            >
              <span className="wc-menuitem-check" aria-hidden="true">
                {o.value === value ? '✓' : ''}
              </span>
              <span className="gr-gt-option-text">{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Contactos de WhatsApp, iguales en Lines y en Inbox: cada persona una vez
 * (teléfono y lid unidos), con sus líneas o cuentas, sus grupos, su último
 * mensaje y su contacto y empresa de HubSpot. Filtros por línea, por chat y
 * por HubSpot; la ficha abre el chat y vincula o crea el contacto en HubSpot
 * sin duplicar (se busca por teléfono antes de crear).
 */
export default function ContactsView({
  app,
  initial,
  lines,
  canWrite,
}: {
  app: 'lines' | 'inbox';
  initial: ContactsDto;
  lines: ContactsLine[];
  /** Puede vincular o crear en HubSpot (no invitados). */
  canWrite: boolean;
}) {
  const t = useTranslations('inboxWa.contacts');
  const ago = useAgo();
  const endpoint = app === 'lines' ? '/api/groups/people' : '/api/inbox/people';
  const [q, setQ] = useState('');
  const [line, setLine] = useState('');
  const [chat, setChat] = useState<ChatFilter>('');
  const [hs, setHs] = useState<HsFilter>('');
  const [data, setData] = useState<ContactsDto | null>(initial);
  const [error, setError] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const lineName = useMemo(() => new Map(lines.map((l) => [l.id, l.name])), [lines]);
  const filtering = Boolean(q.trim() || line || chat || hs);

  const reqKey = JSON.stringify([q.trim(), line, chat, hs]);
  const lastKey = useRef(JSON.stringify(['', '', '', '']));
  const seq = useRef(0);
  const load = useCallback(async () => {
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    if (line) p.set('lines', line);
    if (chat) p.set('chat', chat);
    if (hs) p.set('hubspot', hs);
    const mine = ++seq.current;
    const res = await api<ContactsDto>(`${endpoint}?${p}`);
    if (mine !== seq.current) return;
    if (!res.data) {
      setError(true);
      return;
    }
    setError(false);
    setData(res.data);
  }, [endpoint, q, line, chat, hs]);
  useEffect(() => {
    if (reqKey === lastKey.current) return;
    lastKey.current = reqKey;
    const id = setTimeout(() => void load(), 200);
    return () => clearTimeout(id);
  }, [reqKey, load]);

  const hubspotOn = Boolean(data?.hubspot ?? initial.hubspot);
  const rows = data?.rows ?? [];
  const isLines = app === 'lines';
  const chatHref = (chatId: string) => (isLines ? `/app/lines/inbox/${chatId}` : `/app/inbox?t=${encodeURIComponent(chatId)}`);
  const clear = () => {
    setQ('');
    setLine('');
    setChat('');
    setHs('');
  };
  const onRowChange = (row: ContactRowDto) => setData((d) => (d ? { ...d, rows: d.rows.map((r) => (r.id === row.id ? { ...r, hubspot: row.hubspot } : r)) } : d));
  const open = rows.find((r) => r.id === openId) ?? null;

  return (
    <div className="wc" data-testid="contacts-view">
      <div className="gr-toolbar gr-gt-toolbar wc-toolbar">
        <input
          className="input"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('search')}
          aria-label={t('search')}
          data-testid="contacts-search"
        />
        {lines.length > 1 && (
          <PickMenu
            label={isLines ? t('lineLabel') : t('accountLabel')}
            keyText={isLines ? t('line') : t('account')}
            value={line}
            options={[{ value: '', label: isLines ? t('allLines') : t('allAccounts') }, ...lines.map((l) => ({ value: l.id, label: l.name }))]}
            onPick={setLine}
            testId="contacts-line-filter"
          />
        )}
        <PickMenu<ChatFilter>
          label={t('chatLabel')}
          keyText={t('chat')}
          value={chat}
          options={[
            { value: '', label: t('chatAll') },
            { value: 'dm', label: t('chatDm') },
            { value: 'groups', label: t('chatGroups') },
          ]}
          onPick={setChat}
          testId="contacts-chat-filter"
        />
        {hubspotOn && (
          <PickMenu<HsFilter>
            label={t('hubspotLabel')}
            keyText={t('hubspot')}
            value={hs}
            options={[
              { value: '', label: t('hubspotAll') },
              { value: 'linked', label: t('hubspotLinked') },
              { value: 'unlinked', label: t('hubspotUnlinked') },
            ]}
            onPick={setHs}
            testId="contacts-hubspot-filter"
          />
        )}
        <span className="gr-toolbar-spacer" />
        {data && rows.length > 0 && (
          <span className="ui-help wc-count" data-testid="contacts-count">
            {t('count', { n: rows.length })}
          </span>
        )}
      </div>

      {error && (
        <div className="gr-error" role="alert">
          {t('loadError')}
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void load()}>
            {t('retry')}
          </button>
        </div>
      )}
      {data?.truncated && (
        <p className="gr-banner" role="status">
          {t('truncated', { n: rows.length })}
        </p>
      )}

      {data === null ? (
        <div className="ui-loading-stack" aria-busy="true" aria-label={t('loading')}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="ui-skeleton ui-skeleton-row" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          quiet
          title={filtering ? t('noResults') : t('emptyTitle')}
          body={filtering ? undefined : isLines ? t('emptyLines') : t('emptyInbox')}
          action={
            filtering ? (
              <button type="button" className="btn btn-secondary" onClick={clear}>
                {t('clearFilters')}
              </button>
            ) : undefined
          }
          product={isLines ? 'groups' : 'inbox'}
        />
      ) : (
        <div className="table-wrap table-stack wc-wrap">
          <table className="table gr-table wc-table" aria-label={t('title')} data-testid="contacts-table">
            <thead>
              <tr>
                <th>{t('colName')}</th>
                <th>{isLines ? t('colLines') : t('colAccounts')}</th>
                <th>{t('colGroups')}</th>
                <th>{t('colLast')}</th>
                {hubspotOn && <th>{t('colHubspot')}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const name = r.name || phoneText(r.phone, r.masked) || t('noName');
                const [firstLine, ...moreLines] = r.lines;
                return (
                  <tr key={r.id} data-testid="contact-row" data-person={r.id}>
                    <td className="wc-namecell">
                      <button type="button" className="wc-name" onClick={() => setOpenId(r.id)} aria-label={t('open', { name })} data-testid="contact-open">
                        <Avatar name={r.name || r.phone} kind="dm" src={r.picture || undefined} size={32} seed={r.id} />
                        <span className="wc-name-text">
                          <span className="wc-name-main">{name}</span>
                          <span className="wc-name-sub">{r.name ? phoneText(r.phone, r.masked) || t('lidOnly') : r.phone ? '' : t('lidOnly')}</span>
                        </span>
                      </button>
                    </td>
                    <td data-label={isLines ? t('colLines') : t('colAccounts')}>
                      <span className="wc-chips">
                        {firstLine && <span className="wc-chip">{lineName.get(firstLine) ?? firstLine}</span>}
                        {moreLines.length > 0 && (
                          <span className="wc-more" title={moreLines.map((l) => lineName.get(l) ?? l).join(', ')}>
                            +{moreLines.length}
                            <span className="sr-only"> {t('moreLines', { n: moreLines.length })}</span>
                          </span>
                        )}
                      </span>
                    </td>
                    <td className={r.groupCount ? undefined : 'gr-empty-cell'} data-label={r.groupCount ? t('colGroups') : undefined}>
                      {r.groupCount > 0 && (
                        <span className="wc-groups">
                          <span className="wc-groups-names">{r.groups.slice(0, 2).map((g) => g.name).join(', ')}</span>
                          {r.groupCount > 2 && (
                            <span className="wc-more">
                              +{r.groupCount - 2}
                              <span className="sr-only"> {t('moreGroups', { n: r.groupCount - 2 })}</span>
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className={r.lastMessageAt ? 'ui-help' : 'gr-empty-cell'} data-label={r.lastMessageAt ? t('colLast') : undefined}>
                      {ago(r.lastMessageAt)}
                    </td>
                    {hubspotOn && (
                      <td data-label={t('colHubspot')}>
                        <HubspotCell hs={r.hubspot} />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {open && (
        <ContactDetail
          key={open.id}
          app={app}
          endpoint={endpoint}
          summary={open}
          lineName={lineName}
          hubspotOn={hubspotOn}
          canWrite={canWrite}
          chatHref={chatHref}
          onClose={() => setOpenId(null)}
          onRowChange={onRowChange}
        />
      )}
    </div>
  );
}

function HubspotCell({ hs }: { hs: ContactHubspot | null }) {
  const t = useTranslations('inboxWa.contacts');
  if (!hs?.contact) return <span className="ui-help">{t('notLinked')}</span>;
  return (
    <span className="wc-hs" data-testid="contact-hubspot">
      <a href={hs.contact.url} target="_blank" rel="noopener noreferrer" className="gr-gt-company-link" aria-label={t('hsOpen', { name: hs.contact.name })}>
        <span>{hs.contact.name}</span>
      </a>
      {hs.company && <span className="wc-hs-company">{hs.company.name}</span>}
    </span>
  );
}

function ExternalIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </svg>
  );
}

function Section({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return (
    <section className="wc-section" data-testid={testId}>
      <h3 className="wc-section-title">{title}</h3>
      {children}
    </section>
  );
}

/** La ficha de una persona: sus líneas, grupos y chats, y su contacto de HubSpot. */
function ContactDetail({
  app,
  endpoint,
  summary,
  lineName,
  hubspotOn,
  canWrite,
  chatHref,
  onClose,
  onRowChange,
}: {
  app: 'lines' | 'inbox';
  endpoint: string;
  summary: ContactRowDto;
  lineName: Map<string, string>;
  hubspotOn: boolean;
  canWrite: boolean;
  chatHref: (chatId: string) => string;
  onClose: () => void;
  onRowChange: (row: ContactRowDto) => void;
}) {
  const t = useTranslations('inboxWa.contacts');
  const errText = useErrorText();
  const router = useRouter();
  const [row, setRow] = useState<ContactRowDto>(summary);
  const [loadError, setLoadError] = useState('');
  const [matches, setMatches] = useState<HubspotSuggestion[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const isLines = app === 'lines';
  const linked = Boolean(row.hubspot?.contact);

  // La ficha completa (todos sus grupos y el vínculo al día).
  useEffect(() => {
    let alive = true;
    void api<{ row: ContactRowDto }>(`${endpoint}/person?id=${encodeURIComponent(summary.id)}`).then((res) => {
      if (!alive) return;
      if (res.data) setRow(res.data.row);
      else setLoadError(errText(res.error));
    });
    return () => {
      alive = false;
    };
  }, [endpoint, summary.id, errText]);

  // Sin vínculo: los contactos de HubSpot con su teléfono, para vincular sin duplicar.
  const wantMatches = hubspotOn && canWrite && !linked && Boolean(row.phone) && !row.masked;
  useEffect(() => {
    if (!wantMatches) return;
    let alive = true;
    setMatches(null);
    void api<{ matches: HubspotSuggestion[] }>(`${endpoint}/person?id=${encodeURIComponent(summary.id)}&hubspot=matches`).then((res) => {
      if (!alive) return;
      if (res.data) setMatches(res.data.matches);
      else {
        setMatches([]);
        setNote({ text: errText(res.error), bad: true });
      }
    });
    return () => {
      alive = false;
    };
  }, [wantMatches, endpoint, summary.id, errText]);

  const act = async (kind: string, body: Record<string, unknown>) => {
    setBusy(kind);
    setNote(null);
    const res = await api<{ row: ContactRowDto | null; existing?: HubspotSuggestion[] }>(`${endpoint}/person`, { body: { id: summary.id, ...body } });
    setBusy(null);
    if (!res.data) {
      setNote({ text: errText(res.error), bad: true });
      return null;
    }
    if (res.data.row) {
      setRow(res.data.row);
      onRowChange(res.data.row);
    }
    return res.data;
  };

  const message = async () => {
    if (row.dms[0]) {
      router.push(chatHref(row.dms[0].chatId));
      return;
    }
    setBusy('message');
    const res = await api<{ id: string }>(`${endpoint}/person`, { body: { id: summary.id, action: 'message' } });
    setBusy(null);
    if (res.data?.id) router.push(chatHref(res.data.id));
    else setNote({ text: errText(res.error), bad: true });
  };

  const name = row.name || phoneText(row.phone, row.masked) || t('noName');
  const canMessage = row.dms.length > 0 || (isLines && Boolean(row.phone) && !row.masked);

  return (
    <Modal
      open
      title={
        <span className="wc-title">
          <Avatar name={row.name || row.phone} kind="dm" src={row.picture || undefined} size={40} seed={row.id} />
          <span className="wc-name-text">
            <span className="wc-name-main">{name}</span>
            <span className="wc-name-sub">{row.phone ? phoneText(row.phone, row.masked) : t('lidOnly')}</span>
          </span>
        </span>
      }
      onClose={onClose}
      busy={busy !== null}
      foot={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy !== null} data-testid="contact-close">
            {t('close')}
          </button>
          {canMessage && (
            <button type="button" className="btn btn-primary" onClick={() => void message()} disabled={busy !== null} data-testid="contact-message">
              {row.dms.length ? t('openChat') : t('message')}
            </button>
          )}
        </>
      }
    >
      <div className="wc-detail" data-testid="contact-detail">
        {loadError && (
          <p className="gr-error" role="alert">
            {loadError}
          </p>
        )}
        <Section title={isLines ? t('linesSection') : t('accountsSection')}>
          <ul className="wc-list">
            {row.lines.map((l) => {
              const dm = row.dms.find((d) => d.numberId === l);
              return (
                <li key={l} className="wc-list-item">
                  <span className="wc-chip">{lineName.get(l) ?? l}</span>
                  {dm && (
                    <Link href={chatHref(dm.chatId)} className="wc-link">
                      {t('openChat')}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </Section>
        <Section title={t('groupsSection')} testId="contact-groups">
          {row.groups.length ? (
            <ul className="wc-list">
              {row.groups.map((g) => (
                <li key={g.chatId} className="wc-list-item">
                  <Link href={chatHref(g.chatId)} className="wc-link">
                    {g.name}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ui-help">{t('noGroups')}</p>
          )}
        </Section>
        <Section title={t('hsSection')} testId="contact-hubspot-section">
          {!hubspotOn ? (
            <p className="ui-help">{t('hsOff')}</p>
          ) : linked && row.hubspot?.contact ? (
            <div className="wc-hs-linked">
              <dl className="wc-dl">
                <dt>{t('hsContact')}</dt>
                <dd>
                  <a href={row.hubspot.contact.url} target="_blank" rel="noopener noreferrer" className="gr-gt-company-link" data-testid="contact-hs-contact">
                    <span>{row.hubspot.contact.name}</span>
                    <ExternalIcon />
                  </a>
                  {row.hubspot.contact.broken && <span className="badge badge-warn">{t('hsBroken')}</span>}
                </dd>
                <dt>{t('hsCompany')}</dt>
                <dd>
                  {row.hubspot.company ? (
                    <a href={row.hubspot.company.url} target="_blank" rel="noopener noreferrer" className="gr-gt-company-link" data-testid="contact-hs-company">
                      <span>{row.hubspot.company.name}</span>
                      <ExternalIcon />
                    </a>
                  ) : (
                    <span className="ui-help">{t('hsNoCompany')}</span>
                  )}
                </dd>
              </dl>
              {canWrite ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={busy !== null}
                  data-testid="contact-hs-unlink"
                  onClick={async () => {
                    if (await act('unlink', { action: 'unlink' })) setNote({ text: t('hsUnlinked') });
                  }}
                >
                  {t('hsUnlink')}
                </button>
              ) : (
                <p className="ui-help">{t('hsReadOnly')}</p>
              )}
            </div>
          ) : !canWrite ? (
            <p className="ui-help">{t('notLinked')}</p>
          ) : !row.phone || row.masked ? (
            <p className="ui-help">{t('hsNoPhone')}</p>
          ) : matches === null ? (
            <p className="ui-help" aria-busy="true">
              {t('hsSearching')}
            </p>
          ) : (
            <div className="wc-hs-find">
              {matches.length > 0 ? (
                <>
                  <p className="wc-hs-label">{t('hsMatches')}</p>
                  <ul className="wc-list" data-testid="contact-hs-matches">
                    {matches.map((m) => (
                      <li key={m.contact.id} className="wc-list-item wc-match">
                        <span className="wc-name-text">
                          <span className="wc-name-main">{m.contact.name}</span>
                          {m.company && <span className="wc-name-sub">{m.company.name}</span>}
                        </span>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={busy !== null}
                          aria-label={t('hsLinkName', { name: m.contact.name })}
                          data-testid="contact-hs-link"
                          onClick={async () => {
                            if (await act('link', { action: 'link', contactId: m.contact.id })) setNote({ text: t('hsLinked', { name: m.contact.name }) });
                          }}
                        >
                          {t('hsLink')}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <>
                  <p className="ui-help">{t('hsNoMatches')}</p>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm wc-hs-create"
                    disabled={busy !== null}
                    data-testid="contact-hs-create"
                    onClick={async () => {
                      const res = await act('create', { action: 'create' });
                      if (!res) return;
                      if (res.row) setNote({ text: t('hsCreated') });
                      else if (res.existing?.length) {
                        setMatches(res.existing);
                        setNote({ text: t('hsExisting') });
                      }
                    }}
                  >
                    {t('hsCreate')}
                  </button>
                  <p className="ui-help">{t('hsCreateHelp')}</p>
                </>
              )}
            </div>
          )}
          {note && (
            <p className={note.bad ? 'wc-note is-bad' : 'wc-note'} role={note.bad ? 'alert' : 'status'} data-testid="contact-hs-note">
              {note.text}
            </p>
          )}
        </Section>
      </div>
    </Modal>
  );
}
