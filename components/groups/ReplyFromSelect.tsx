'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { pickReplyLine, type ReplyLine } from '@/lib/groups-lines-shared';
import { api } from './ui';

const STORE = 'groups.replyFrom';

function savedLine(chatId: string): string | null {
  try {
    return (JSON.parse(window.localStorage.getItem(STORE) ?? '{}') as Record<string, string>)[chatId] ?? null;
  } catch {
    return null;
  }
}

function saveLine(chatId: string, numberId: string): void {
  try {
    const all = JSON.parse(window.localStorage.getItem(STORE) ?? '{}') as Record<string, string>;
    all[chatId] = numberId;
    const keys = Object.keys(all);
    // Como mucho 200 chats recordados.
    for (const k of keys.slice(0, Math.max(0, keys.length - 200))) delete all[k];
    window.localStorage.setItem(STORE, JSON.stringify(all));
  } catch {
    // Sin storage (modo privado): se elige la línea del chat.
  }
}

/**
 * "Responder desde": elige la línea por la que sale la respuesta cuando el
 * chat está en más de una línea de la org (o es un 1:1 y hay otras líneas).
 * Si hay una sola línea no muestra nada.
 *
 * Uso (composer): `<ReplyFromSelect chatId={chat.id} lines={page.lines} onChange={setNumberId} />`
 * y al enviar, `POST /api/groups/chats/:id/messages` con `{ ..., numberId }`.
 * Sin `lines`, las pide a `GET /api/groups/lines?chat=<id>`.
 * Recuerda la elección por chat en este navegador.
 */
export default function ReplyFromSelect({
  chatId,
  lines: given,
  onChange,
  compact = false,
}: {
  chatId: string;
  lines?: ReplyLine[];
  /** numberId elegido (o null si hay una sola línea). Se llama también con el valor inicial. */
  onChange: (numberId: string | null, line: ReplyLine | null) => void;
  /** Solo el selector, sin el texto "Responder desde". */
  compact?: boolean;
}) {
  const t = useTranslations('groups');
  const [lines, setLines] = useState<ReplyLine[]>(given ?? []);
  const [value, setValue] = useState('');

  useEffect(() => {
    if (given) {
      setLines(given);
      return;
    }
    let alive = true;
    void api<{ lines: ReplyLine[] }>(`/api/groups/lines?chat=${encodeURIComponent(chatId)}`).then((r) => {
      if (alive && r.data) setLines(r.data.lines);
    });
    return () => {
      alive = false;
    };
  }, [chatId, given]);

  useEffect(() => {
    const pick = pickReplyLine(lines, savedLine(chatId));
    setValue(pick?.numberId ?? '');
    onChange(lines.length > 1 ? (pick?.numberId ?? null) : null, pick);
    // onChange no entra: el composer puede pasar una función nueva en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, chatId]);

  if (lines.length < 2) return null;
  const current = lines.find((l) => l.numberId === value);
  return (
    <label className={`gr-replyfrom${compact ? ' is-compact' : ''}`}>
      {!compact && <span className="gr-replyfrom-label">{t('lines.replyFrom')}</span>}
      <span className="gr-line-dot" style={{ background: current?.color }} aria-hidden="true" />
      <select
        className="select"
        value={value}
        aria-label={t('lines.replyFrom')}
        onChange={(e) => {
          const line = lines.find((l) => l.numberId === e.target.value) ?? null;
          setValue(e.target.value);
          saveLine(chatId, e.target.value);
          onChange(e.target.value, line);
        }}
      >
        {lines.map((l) => (
          <option key={l.numberId} value={l.numberId} disabled={!l.canSend}>
            {l.name}
            {l.phone ? ` · +${l.phone}` : ''}
            {!l.canSend ? ` (${l.status === 'connected' ? t('lines.leftChat') : t(`numberStatus.${l.status}`)})` : ''}
          </option>
        ))}
      </select>
    </label>
  );
}
