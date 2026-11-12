'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import type { NumberDto } from '@/lib/groups';
import type { NewChatResult } from '@/lib/groups-new-chat';
import { looksLikePhone, parseNewChatPhone } from '@/lib/groups-new-chat-shared';
import { Modal, NumberOptions, api, defaultNumberId, useErrorText } from './ui';
import Avatar from './wa/Avatar';
import { GroupIcon, Plus } from './wa/icons';

/** Espera entre la última tecla y la búsqueda. */
const SEARCH_DELAY_MS = 300;

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
 * "Chat nuevo" de la bandeja de Lines: elegir la línea, buscar un contacto o
 * un chat de esa línea por nombre o teléfono, o escribir un número que no
 * está en la libreta. Abre el chat 1:1 (el que ya existe, o uno nuevo) con el
 * campo de mensaje listo. No manda nada a WhatsApp.
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
  const errText = useErrorText();
  const router = useRouter();
  const [numbers, setNumbers] = useState<NumberDto[] | null>(null);
  const [numberId, setNumberId] = useState('');
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<NewChatResult[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tried, setTried] = useState(false);
  const seq = useRef(0);

  // Al abrir: las líneas que la persona ve, con su estado (una sola lectura).
  useEffect(() => {
    if (!open) return;
    setText('');
    setQuery('');
    setRows(null);
    setError('');
    setTried(false);
    setLoadError(false);
    let alive = true;
    void api<{ numbers: NumberDto[] }>('/api/groups/numbers').then((r) => {
      if (!alive) return;
      if (!r.data) {
        setNumbers([]);
        setLoadError(true);
        return;
      }
      setNumbers(r.data.numbers);
      setNumberId(defaultNumberId(r.data.numbers, line === 'all' ? null : line));
    });
    return () => {
      alive = false;
    };
  }, [open, line]);

  // La búsqueda espera a que se deje de escribir.
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => setQuery(text.trim()), SEARCH_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [text, open]);

  const number = numbers?.find((n) => n.id === numberId) ?? null;
  const connected = number?.status === 'connected';

  useEffect(() => {
    if (!open || !numberId) return;
    const mine = ++seq.current;
    setLoadError(false);
    void api<{ rows: NewChatResult[] }>(`/api/groups/contacts?${new URLSearchParams({ number: numberId, q: query })}`).then((r) => {
      // Una respuesta vieja (se siguió escribiendo o se cambió de línea) no pisa la nueva.
      if (mine !== seq.current) return;
      setRows(r.data?.rows ?? []);
      setLoadError(!r.data);
    });
  }, [open, numberId, query]);

  const typed = useMemo(() => (looksLikePhone(text) ? parseNewChatPhone(text) : null), [text]);
  // El número escrito ya está entre los resultados: no se ofrece dos veces.
  const direct = typed?.ok && connected && !(rows ?? []).some((r) => r.phone === typed.phone) ? typed.phone : '';
  const phoneHint = typed && !typed.ok && typed.error !== 'not_a_phone' ? typed.error : null;
  const settled = query === text.trim();

  function go(chatId: string) {
    onClose();
    router.push(`/app/lines/inbox/${chatId}${suffix}`);
    // Después de que el diálogo se cierre: al cerrarse devuelve el foco al botón que lo abrió.
    window.setTimeout(() => focusComposerOf(chatId), 80);
  }

  async function start(body: { phone: string } | { contactId: string }) {
    if (busy || !numberId) return;
    setBusy(true);
    setError('');
    const r = await api<{ id: string }>('/api/groups/chats', { body: { numberId, ...body } });
    setBusy(false);
    if (!r.data) {
      setError(errText(r.error));
      return;
    }
    go(r.data.id);
  }

  function pick(r: NewChatResult) {
    if (r.chatId) go(r.chatId);
    else if (r.contactId) void start({ contactId: r.contactId });
  }

  // Enter: el número escrito si se ofrece; si no, el primer resultado.
  function submit() {
    setTried(true);
    if (direct) void start({ phone: direct });
    else if (settled && rows?.length && text.trim()) pick(rows[0]);
  }

  return (
    <Modal
      open={open}
      title={t('newChat.title')}
      onClose={onClose}
      onSubmit={submit}
      busy={busy}
      foot={
        <>
          <Link href="/app/lines/list?new=1" className="btn btn-ghost gr-newchat-group" onClick={onClose}>
            <GroupIcon size={16} />
            {t('newChat.newGroup')}
          </Link>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </>
      }
    >
      <div className="ui-fields gr-newchat">
        {numbers && numbers.length > 1 && (
          <label className="ui-field">
            <span className="label">{t('newChat.from')}</span>
            <select
              className="select"
              value={numberId}
              onChange={(e) => {
                setNumberId(e.target.value);
                setRows(null);
                setError('');
              }}
            >
              <NumberOptions numbers={numbers} />
            </select>
          </label>
        )}
        <label className="ui-field">
          <span className="label">{t('newChat.search')}</span>
          <input
            className="input"
            type="search"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError('');
              setTried(false);
            }}
            placeholder={t('newChat.placeholder')}
            autoComplete="off"
            autoFocus
          />
        </label>
        {number && !connected && (
          <p className="ui-error" role="alert">
            {t('newChat.lineOff', { status: t(`numberStatus.${number.status}`) })}
          </p>
        )}
        {phoneHint && (
          <p className={tried || phoneHint === 'too_long' ? 'ui-error' : 'ui-help'} role={tried || phoneHint === 'too_long' ? 'alert' : 'status'}>
            {t(`newChat.${phoneHint === 'too_long' ? 'tooLong' : 'tooShort'}`)}
          </p>
        )}
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
        {direct && (
          <button type="button" className="gr-newchat-row gr-newchat-direct" onClick={() => void start({ phone: direct })} disabled={busy} aria-busy={busy || undefined}>
            <span className="gr-newchat-plus" aria-hidden="true">
              <Plus size={18} />
            </span>
            <span className="gr-newchat-text">
              <span className="gr-newchat-name">{t('newChat.message', { phone: `+${direct}` })}</span>
              <span className="gr-newchat-phone">{t('newChat.messageHelp')}</span>
            </span>
          </button>
        )}
        {numbers === null || (numberId && rows === null) ? (
          <p className="ui-help" role="status">
            {t('common.loading')}
          </p>
        ) : loadError ? (
          <p className="ui-error" role="alert">
            {t('newChat.loadError')}
          </p>
        ) : rows && rows.length > 0 ? (
          <ul className="gr-newchat-list" aria-label={text.trim() ? t('newChat.results') : t('newChat.recent')}>
            {rows.map((r) => (
              <li key={r.key}>
                <button type="button" className="gr-newchat-row" onClick={() => pick(r)} disabled={busy || (!r.chatId && !connected)}>
                  <Avatar name={r.name} kind="dm" src={r.pictureUrl || undefined} size={36} />
                  <span className="gr-newchat-text">
                    <span className="gr-newchat-name">{r.name}</span>
                    {r.phoneLabel && r.phoneLabel !== r.name && <span className="gr-newchat-phone">{r.phoneLabel}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          !direct &&
          !phoneHint && (
            <p className="ui-help" role="status">
              {text.trim() ? (settled ? t('newChat.noResults') : t('common.loading')) : t('newChat.empty')}
            </p>
          )
        )}
      </div>
    </Modal>
  );
}
