'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ChatDto, MessageDto } from '@/lib/groups';
import { Modal, api, useErrorText } from '../ui';
import Avatar from './Avatar';

interface Pick {
  key: string;
  name: string;
  phone: string;
}

/**
 * "Contacto" del menú +: elegir hasta 5 contactos (los chats 1 a 1 de la
 * bandeja, con búsqueda) o escribir un nombre y un número, y mandarlos como
 * tarjetas de WhatsApp.
 */
export default function ContactPicker({ open, chatId, onClose, onSent }: { open: boolean; chatId: string; onClose: () => void; onSent: (m: MessageDto) => void }) {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<ChatDto[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [picked, setPicked] = useState<Pick[]>([]);
  const [manual, setManual] = useState({ name: '', phone: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setPicked([]);
    setManual({ name: '', phone: '' });
    setError('');
    setQ('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const id = setTimeout(async () => {
      const p = new URLSearchParams({ kind: 'dm', limit: '40' });
      if (q.trim()) p.set('q', q.trim());
      const res = await api<{ rows: ChatDto[] }>(`/api/groups/chats?${p}`, { method: 'GET' });
      if (!alive) return;
      setLoadError(!res.data);
      setRows(res.data ? res.data.rows.filter((r) => r.phone) : []);
    }, q ? 200 : 0);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [open, q]);

  function toggle(c: ChatDto) {
    setPicked((prev) =>
      prev.some((p) => p.key === c.id) ? prev.filter((p) => p.key !== c.id) : prev.length >= 5 ? prev : [...prev, { key: c.id, name: c.name, phone: c.phone }],
    );
  }

  async function send() {
    const list = [...picked];
    const digits = manual.phone.replace(/[^\d]/g, '');
    if (digits) {
      if (digits.length < 8) return setError(errText('invalid_contact_card'));
      list.push({ key: 'manual', name: manual.name.trim(), phone: digits });
    }
    if (list.length === 0) return setError(t('wa.contactPickOne'));
    setBusy(true);
    setError('');
    const res = await api<MessageDto>(`/api/groups/chats/${chatId}/messages`, { body: { contacts: list.map((p) => ({ name: p.name, phone: p.phone })) } });
    setBusy(false);
    if (!res.data) return setError(errText(res.error));
    onSent(res.data);
  }

  const count = picked.length + (manual.phone.replace(/[^\d]/g, '') ? 1 : 0);
  return (
    <Modal
      open={open}
      title={t('wa.contactTitle')}
      onClose={onClose}
      onSubmit={() => void send()}
      busy={busy}
      foot={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" aria-busy={busy || undefined} disabled={count === 0}>
            {count > 1 ? t('wa.contactSendN', { n: count }) : t('wa.contactSend')}
          </button>
        </>
      }
    >
      <div className="ui-fields">
        <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('wa.contactSearch')} aria-label={t('wa.contactSearch')} />
        {rows === null ? (
          <div className="ui-loading-stack" aria-busy="true" aria-label={t('common.loading')}>
            <div className="ui-skeleton ui-skeleton-row" />
            <div className="ui-skeleton ui-skeleton-row" />
          </div>
        ) : loadError ? (
          <p className="ui-error" role="alert">
            {t('inbox.loadError')}
          </p>
        ) : rows.length === 0 ? (
          <p className="ui-help">{q ? t('inbox.noResults') : t('wa.contactNone')}</p>
        ) : (
          <ul className="wa-contact-pick" aria-label={t('wa.contactTitle')}>
            {rows.map((c) => {
              const on = picked.some((p) => p.key === c.id);
              return (
                <li key={c.id}>
                  <label className={on ? 'is-on' : ''}>
                    <input type="checkbox" className="ui-check" checked={on} onChange={() => toggle(c)} disabled={!on && picked.length >= 5} />
                    <Avatar name={c.name} kind="dm" src={c.pictureUrl} seed={c.id} size={36} />
                    <span className="wa-contact-pick-main">
                      <span>{c.name}</span>
                      <small>+{c.phone}</small>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        <fieldset className="ui-field">
          <legend className="label">{t('wa.contactOther')}</legend>
          <div className="wa-contact-manual">
            <input className="input" value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })} placeholder={t('wa.contactName')} aria-label={t('wa.contactName')} maxLength={100} />
            <input className="input" type="tel" inputMode="tel" value={manual.phone} onChange={(e) => setManual({ ...manual, phone: e.target.value })} placeholder="+54 9 11 5555 0000" aria-label={t('wa.contactPhone')} maxLength={30} />
          </div>
        </fieldset>
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
