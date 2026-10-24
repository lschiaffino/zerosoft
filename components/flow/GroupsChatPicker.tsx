'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

interface ChatLite {
  id: string;
  name: string;
  kind: 'dm' | 'group';
}

/**
 * Buscador de chats y grupos de Groups para el paso "Groups: mandar mensaje".
 * Elegir uno pone su id en el campo; el campo sigue aceptando variables
 * ({{trigger.chat.id}}) para mandar al chat del evento.
 */
export default function GroupsChatPicker({ value, onPick }: { value: string; onPick: (chatId: string) => void }) {
  const t = useTranslations('flow.groupsPicker');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<ChatLite[]>([]);
  const [current, setCurrent] = useState<ChatLite | null>(null);

  // Nombre del chat elegido (si el campo tiene un id y no una variable).
  useEffect(() => {
    if (!value || value.includes('{{')) {
      setCurrent(null);
      return;
    }
    let alive = true;
    fetch(`/api/groups/chats/${encodeURIComponent(value)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { chat?: ChatLite } | null) => {
        if (alive) setCurrent(d?.chat ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [value]);

  useEffect(() => {
    const needle = q.trim();
    if (needle.length < 2) {
      setRows([]);
      return;
    }
    const id = setTimeout(() => {
      fetch(`/api/groups/chats?q=${encodeURIComponent(needle)}&limit=8`)
        .then((r) => (r.ok ? r.json() : { rows: [] }))
        .then((d: { rows?: ChatLite[] }) => setRows(d.rows ?? []))
        .catch(() => setRows([]));
    }, 250);
    return () => clearTimeout(id);
  }, [q]);

  return (
    <div className="flow-groups-picker">
      {current && <p className="ui-help">{t('current', { name: current.name })}</p>}
      <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search')} aria-label={t('search')} />
      {rows.length > 0 && (
        <ul className="flow-groups-results" role="listbox" aria-label={t('search')}>
          {rows.map((c) => (
            <li key={c.id} role="option" aria-selected={c.id === value}>
              <button
                type="button"
                onClick={() => {
                  onPick(c.id);
                  setCurrent(c);
                  setQ('');
                  setRows([]);
                }}
              >
                {c.name} <span className="ui-help">{c.kind === 'group' ? t('group') : t('dm')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="ui-help">{t('help')}</p>
    </div>
  );
}
