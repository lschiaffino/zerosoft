'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import type { NotesAdminAuditEntry, NotesAdminLink, NotesAdminMember } from '@/lib/notes-admin';

/** Dirección secreta para mandarse notas por email. */
export function NotesEmailPanel() {
  const t = useTranslations('notes.email');
  const [address, setAddress] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const call = useCallback(async (method: 'GET' | 'POST') => {
    setError(false);
    setBusy(true);
    const res = await fetch('/api/notes/email-address', { method }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(true);
      return;
    }
    setAddress(((await res.json()) as { address: string | null }).address);
  }, []);
  useEffect(() => {
    void call('GET');
  }, [call]);

  return (
    <div className="st-stack notes-settings-panel">
      <p className="ui-help">{t('lead')}</p>
      {error && (
        <p className="ui-error" role="alert">
          {t('error')}
        </p>
      )}
      {address === undefined && !error && <p className="ui-help" role="status">{t('loading')}</p>}
      {address === null && <p className="ui-help" data-testid="notes-email-unavailable">{t('unavailable')}</p>}
      {address && (
        <>
          <div className="notes-pop-row">
            <input className="input data" readOnly value={address} aria-label={t('address')} data-testid="notes-email-address" onFocus={(e) => e.currentTarget.select()} />
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                void navigator.clipboard?.writeText(address).catch(() => {});
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? t('copied') : t('copy')}
            </button>
          </div>
          <ul className="notes-settings-tips">
            <li>{t('tipSubject')}</li>
            <li>{t('tipAttachments')}</li>
          </ul>
          <div>
            <button type="button" className="btn btn-sm" aria-busy={busy} onClick={() => void call('POST')}>
              {t('rotate')}
            </button>
            <p className="ui-help">{t('rotateHint')}</p>
          </div>
        </>
      )}
    </div>
  );
}

/** Consola de admin: uso por persona, links públicos y pasar notas entre personas. */
export function NotesAdminPanel({ selfId }: { selfId: string }) {
  const t = useTranslations('notes.admin');
  const format = useFormatter();
  const [data, setData] = useState<{ members: NotesAdminMember[]; former: NotesAdminMember[]; links: NotesAdminLink[]; audit: NotesAdminAuditEntry[]; ocr: boolean } | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    const res = await fetch('/api/notes/admin').catch(() => null);
    if (!res?.ok) {
      setError(true);
      return;
    }
    setData((await res.json()) as typeof data);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function post(body: Record<string, string | boolean>): Promise<boolean> {
    setBusy(true);
    setError(false);
    const res = await fetch('/api/notes/admin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(true);
      return false;
    }
    setData((await res.json()) as typeof data);
    return true;
  }

  const who = (m: NotesAdminMember) => m.name || m.email;
  if (!data) {
    return error ? (
      <div className="notes-list-error" role="alert">
        <p>{t('error')}</p>
        <button type="button" className="btn btn-sm" onClick={() => void load()}>
          {t('retry')}
        </button>
      </div>
    ) : (
      <p className="ui-help" role="status">{t('loading')}</p>
    );
  }
  return (
    <div className="st-stack notes-settings-panel" data-testid="notes-admin">
      <p className="ui-help">{t('lead')}</p>
      {error && (
        <p className="ui-error" role="alert">
          {t('error')}
        </p>
      )}
      <section>
        <h3 className="notes-settings-h">{t('ocrTitle')}</h3>
        <label className="notes-clip-mode">
          <input type="checkbox" checked={data.ocr} disabled={busy} onChange={(e) => void post({ action: 'ocr', enabled: e.target.checked })} />
          <span>
            <strong>{t('ocrLabel')}</strong>
            <span className="ui-help">{t('ocrHint')}</span>
          </span>
        </label>
      </section>
      <section>
        <h3 className="notes-settings-h">{t('people')}</h3>
        <div className="notes-admin-scroll">
          <table className="notes-admin-table">
            <thead>
              <tr>
                <th scope="col">{t('person')}</th>
                <th scope="col">{t('notes')}</th>
                <th scope="col">{t('notebooks')}</th>
                <th scope="col">{t('shares')}</th>
                <th scope="col">{t('links')}</th>
                <th scope="col">{t('lastUpdate')}</th>
              </tr>
            </thead>
            <tbody>
              {data.members.map((m) => (
                <tr key={m.id}>
                  <td>{who(m)}</td>
                  <td className="num">{m.notes}</td>
                  <td className="num">{m.notebooks}</td>
                  <td className="num">{m.shares}</td>
                  <td className="num">{m.public_links}</td>
                  <td>{m.last_update ? format.dateTime(new Date(m.last_update), { dateStyle: 'medium' }) : t('never')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section>
        <h3 className="notes-settings-h">{t('publicLinks')}</h3>
        {data.links.length === 0 ? (
          <p className="ui-help">{t('noLinks')}</p>
        ) : (
          <ul className="notes-admin-links">
            {data.links.map((l) => (
              <li key={l.note_id}>
                <a href={`/n/${l.token}`} target="_blank" rel="noopener noreferrer">
                  {l.title || t('untitled')}
                </a>
                <span className="ui-help">{l.owner}</span>
                <button type="button" className="btn btn-sm btn-ghost btn-danger" disabled={busy} onClick={() => void post({ action: 'disable_link', note_id: l.note_id })}>
                  {t('disableLink')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3 className="notes-settings-h">{t('transfer')}</h3>
        <p className="ui-help">{t('transferHint')}</p>
        {data.former.length === 0 ? (
          <p className="ui-help">{t('noFormer')}</p>
        ) : (
          <div className="notes-admin-transfer">
            <select className="select" value={from} aria-label={t('from')} onChange={(e) => { setFrom(e.target.value); setConfirming(false); setDone(false); }}>
              <option value="">{t('from')}</option>
              {data.former.map((m) => (
                <option key={m.id} value={m.id}>
                  {who(m)} ({m.notes})
                </option>
              ))}
            </select>
            <select className="select" value={to} aria-label={t('to')} onChange={(e) => { setTo(e.target.value); setConfirming(false); setDone(false); }}>
              <option value="">{t('to')}</option>
              {data.members.filter((m) => m.id !== selfId).map((m) => (
                <option key={m.id} value={m.id}>
                  {who(m)}
                </option>
              ))}
            </select>
            {confirming ? (
              <button
                type="button"
                className="btn btn-sm btn-danger"
                aria-busy={busy}
                onClick={() =>
                  void post({ action: 'transfer', from, to }).then((ok) => {
                    setConfirming(false);
                    setDone(ok);
                  })
                }
              >
                {t('transferConfirm')}
              </button>
            ) : (
              <button type="button" className="btn btn-sm" disabled={!from || !to} onClick={() => setConfirming(true)}>
                {t('transferAction')}
              </button>
            )}
          </div>
        )}
        {done && <p className="ui-help" role="status">{t('transferDone')}</p>}
      </section>
      {data.audit.length > 0 && (
        <section>
          <h3 className="notes-settings-h">{t('auditTitle')}</h3>
          <ul className="notes-admin-links">
            {data.audit.map((a) => (
              <li key={a.id} className="ui-help">
                {format.dateTime(new Date(a.created_at), { dateStyle: 'medium', timeStyle: 'short' })} · {a.actor} · {t(a.action === 'transfer' ? 'auditTransfer' : 'auditLink')}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
