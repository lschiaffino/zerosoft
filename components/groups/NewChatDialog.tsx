'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import type { NumberDto } from '@/lib/groups';
import type { NewChatDirectory } from '@/lib/wa-new-chat';
import { NumberOptions, api, defaultNumberId, useErrorText } from './ui';
import NewChatPanel, { type NewChatAction } from './wa/NewChatPanel';
import { GroupIcon } from './wa/icons';

/**
 * El campo de mensaje del chat recién abierto toma el foco cuando aparece
 * (la página del chat llega después de navegar). Mira el DOM, no la red, y
 * se rinde a los 8 segundos. Si la página se vuelve a dibujar enseguida y el
 * foco se pierde (queda en <body>), lo vuelve a poner; si la persona ya lo
 * llevó a otro lado, no se lo saca.
 */
function focusComposerOf(chatId: string) {
  let done = false;
  let timer = 0;
  const obs = new MutationObserver(() => tryFocus());
  const stop = () => {
    obs.disconnect();
    window.clearTimeout(timer);
  };
  function tryFocus() {
    if (!window.location.pathname.endsWith(`/${chatId}`)) return;
    const active = document.activeElement;
    if (done && active && active !== document.body) return;
    const input = document.querySelector<HTMLTextAreaElement>('textarea.gr-input:not([disabled])');
    if (!input) return;
    input.focus();
    if (!done) {
      done = true;
      window.setTimeout(stop, 1500);
    }
  }
  timer = window.setTimeout(stop, 8000);
  obs.observe(document.body, { childList: true, subtree: true });
  tryFocus();
}

/**
 * "Chat nuevo" de Lines: el panel de WhatsApp Web (wa/NewChatPanel) sobre una
 * línea. Con varias líneas, el selector va arriba. Elegir un contacto abre su
 * chat 1:1 (el que ya existe, o uno nuevo) con el campo de mensaje listo;
 * "Grupo nuevo" lleva a crear un grupo. No manda nada a WhatsApp.
 */
export default function NewChatDialog({
  open,
  onClose,
  line,
  suffix = '',
}: {
  open: boolean;
  onClose: () => void;
  /** Línea elegida en la bandeja ('all' = todas). */
  line: string;
  /** Query de la bandeja (lista guardada, carpeta) que viaja al abrir el chat. */
  suffix?: string;
}) {
  const t = useTranslations('groups');
  const tn = useTranslations('inboxWa.newChat');
  const errText = useErrorText();
  const router = useRouter();
  const [numbers, setNumbers] = useState<NumberDto[] | null>(null);
  const [numberId, setNumberId] = useState('');
  const [numbersError, setNumbersError] = useState(false);

  // Al abrir: las líneas que la persona ve, con su estado (una sola lectura).
  useEffect(() => {
    if (!open) return;
    setNumbersError(false);
    let alive = true;
    void api<{ numbers: NumberDto[] }>('/api/groups/numbers').then((r) => {
      if (!alive) return;
      if (!r.data) {
        setNumbers([]);
        setNumbersError(true);
        return;
      }
      setNumbers(r.data.numbers);
      setNumberId(defaultNumberId(r.data.numbers, line === 'all' ? null : line));
    });
    return () => {
      alive = false;
    };
  }, [open, line]);

  const number = numbers?.find((n) => n.id === numberId) ?? null;
  const connected = number?.status === 'connected';

  const load = useCallback(
    async ({ q, cursor, signal }: { q: string; cursor: string | null; signal: AbortSignal }): Promise<NewChatDirectory | null> => {
      if (!numberId) return { self: null, frequent: [], contacts: [], next: null, total: 0 };
      const params = new URLSearchParams({ number: numberId, q });
      if (cursor) params.set('cursor', cursor);
      const r = await api<NewChatDirectory>(`/api/groups/contacts?${params}`, { signal });
      return r.data;
    },
    [numberId],
  );

  function go(chatId: string) {
    onClose();
    router.push(`/app/lines/inbox/${chatId}${suffix}`);
    // Después de que el panel se cierre: al cerrarse devuelve el foco al botón que lo abrió.
    window.setTimeout(() => focusComposerOf(chatId), 80);
  }

  async function start(body: { phone: string } | { contactId: string }): Promise<string | null> {
    if (!numberId) return null;
    const r = await api<{ id: string }>('/api/groups/chats', { body: { numberId, ...body } });
    if (!r.data) return errText(r.error);
    go(r.data.id);
    return null;
  }

  const actions = useMemo<NewChatAction[]>(() => [{ key: 'group', label: tn('newGroup'), icon: <GroupIcon size={20} />, href: '/app/lines/list?new=1' }], [tn]);

  return (
    <NewChatPanel
      open={open}
      onClose={onClose}
      sourceKey={numbers === null ? '' : numberId || 'none'}
      load={load}
      canStart={connected}
      actions={actions}
      onPick={async (e) => {
        if (e.chatId) {
          go(e.chatId);
          return null;
        }
        if (e.contactId) return start({ contactId: e.contactId });
        return null;
      }}
      onPhone={(phone) => start({ phone })}
      header={
        numbers && numbers.length > 1 ? (
          <label className="wa-nc-line">
            <span className="wa-nc-line-label">{t('newChat.from')}</span>
            <select className="select" value={numberId} onChange={(e) => setNumberId(e.target.value)}>
              <NumberOptions numbers={numbers} />
            </select>
          </label>
        ) : null
      }
      notice={
        number && !connected ? (
          <p className="wa-nc-msg ui-error" role="alert">
            {t('newChat.lineOff', { status: t(`numberStatus.${number.status}`) })}
          </p>
        ) : numbersError ? (
          <p className="wa-nc-msg ui-error" role="alert">
            {tn('loadError')}
          </p>
        ) : null
      }
    />
  );
}
