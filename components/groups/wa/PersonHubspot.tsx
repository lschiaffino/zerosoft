'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ContactRowDto } from '@/lib/groups-contacts';
import type { HubspotSuggestion } from '@/lib/groups-hubspot';
import { api, useErrorText } from '../dialog-kit';

export function ExternalIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </svg>
  );
}

/**
 * El contacto de HubSpot de una persona, igual en Lines y en Inbox: en la
 * ficha de Contactos y en el chat 1:1. Vinculado: el contacto y su empresa
 * con link a HubSpot y "Desvincular". Sin vincular: primero los contactos de
 * HubSpot con su teléfono (para no duplicar) y, si no hay, "Crear en HubSpot".
 * `endpoint`: /api/groups/people o /api/inbox/people.
 */
export default function PersonHubspot({
  endpoint,
  row,
  onRow,
  hubspotOn,
  canWrite,
}: {
  endpoint: string;
  row: ContactRowDto;
  onRow: (row: ContactRowDto) => void;
  hubspotOn: boolean;
  canWrite: boolean;
}) {
  const t = useTranslations('inboxWa.contacts');
  const errText = useErrorText();
  const [matches, setMatches] = useState<HubspotSuggestion[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const linked = Boolean(row.hubspot?.contact);

  // Sin vínculo: los contactos de HubSpot con su teléfono, para vincular sin duplicar.
  const wantMatches = hubspotOn && canWrite && !linked && Boolean(row.phone) && !row.masked;
  useEffect(() => {
    if (!wantMatches) return;
    let alive = true;
    setMatches(null);
    void api<{ matches: HubspotSuggestion[] }>(`${endpoint}/person?id=${encodeURIComponent(row.id)}&hubspot=matches`).then((res) => {
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
  }, [wantMatches, endpoint, row.id, errText]);

  const act = async (kind: string, body: Record<string, unknown>) => {
    setBusy(kind);
    setNote(null);
    const res = await api<{ row: ContactRowDto | null; existing?: HubspotSuggestion[] }>(`${endpoint}/person`, { body: { id: row.id, ...body } });
    setBusy(null);
    if (!res.data) {
      setNote({ text: errText(res.error), bad: true });
      return null;
    }
    if (res.data.row) onRow(res.data.row);
    return res.data;
  };

  return (
    <div className="wc-hs-block" aria-busy={busy !== null || undefined}>
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
                aria-busy={busy === 'create' || undefined}
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
    </div>
  );
}

/**
 * El contacto de HubSpot de un chat 1:1: busca la persona del chat
 * (`?chat=` en Lines, `?thread=` en Inbox) y muestra PersonHubspot. Sin
 * HubSpot conectado (o para un invitado de Inbox) no muestra nada.
 */
export function ChatPersonHubspot({
  endpoint,
  query,
  canWrite,
  onRow,
}: {
  endpoint: string;
  /** chat=<id> o thread=<id>. */
  query: string;
  canWrite: boolean;
  onRow?: (row: ContactRowDto) => void;
}) {
  const t = useTranslations('inboxWa.contacts');
  const errText = useErrorText();
  const [row, setRow] = useState<ContactRowDto | null>(null);
  const [error, setError] = useState('');
  const [seq, setSeq] = useState(0);

  useEffect(() => {
    let alive = true;
    setRow(null);
    setError('');
    void api<{ row: ContactRowDto }>(`${endpoint}/person?${query}`).then((res) => {
      if (!alive) return;
      if (res.data) setRow(res.data.row);
      else setError(errText(res.error));
    });
    return () => {
      alive = false;
    };
  }, [endpoint, query, errText, seq]);

  if (error)
    return (
      <p className="ui-help" role="alert">
        {error}{' '}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSeq((n) => n + 1)}>
          {t('retry')}
        </button>
      </p>
    );
  if (!row)
    return (
      <div aria-busy="true">
        <span className="ui-skeleton ui-skeleton-row" />
      </div>
    );
  if (!row.hubspot) return null;
  return (
    <PersonHubspot
      endpoint={endpoint}
      row={row}
      hubspotOn
      canWrite={canWrite}
      onRow={(next) => {
        setRow(next);
        onRow?.(next);
      }}
    />
  );
}
