'use client';

import LocalText from '@/components/ui/LocalText';
import { useEffect, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import SearchClear from '@/components/app/SearchClear';

// El menú vive en wa/Menu.tsx (también lo usa Inbox); se reexporta para los imports de siempre.
export { MessageMenu, type MenuItem } from './wa/Menu';
import type { ChatDto, MessageDto } from '@/lib/groups';
import { MAX_FORWARD_TARGETS, formatDuration } from '@/lib/groups-inbox-rules';
import { ChatPlate, Modal, api, useErrorText, useMediaText } from './ui';
import { parseDbUtc } from '@/lib/utils';
import { GroupEventLine } from './wa/GroupEvent';
import SharedPinnedBar from './wa/PinnedBar';
import { parseEvent } from '@/lib/wa-group-events';

/** Línea de sistema del hilo: llamada o evento del historial (asignación, equipo, cierre). */
export function SystemLine({ m, nameOf }: { m: MessageDto; nameOf: (id: string | null | undefined) => string }) {
  const t = useTranslations('groups.history');
  const locale = useLocale();
  const time = parseDbUtc(m.createdAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const meta = m.meta as Record<string, string | number | boolean | undefined>;
  let text: ReactNode = '';
  let extra: ReactNode = null;
  // Aviso del grupo de WhatsApp ("Ana te agregó", "Beto salió"): lib/wa-group-events.ts.
  if (m.authorKind === 'wa') {
    const e = parseEvent((m.meta as Record<string, unknown>).sys);
    return e ? <GroupEventLine e={e} id={m.id} /> : null;
  }
  if (m.authorKind === 'call') {
    const dir = meta.direction === 'out' ? 'out' : 'in';
    const status = String(meta.status ?? 'ringing');
    const key = status === 'missed' || status === 'rejected' ? `call_${status}_${dir}` : `call_${dir}`;
    text = t(key);
    if (Number(meta.durationSec) > 0) extra = <span className="gr-call-len">{formatDuration(Number(meta.durationSec))}</span>;
    else if (status === 'ringing') extra = <span className="ui-help">{t('call_ringing')}</span>;
    else if (status === 'answered') extra = <span className="ui-help">{t('call_answered')}</span>;
    if (typeof meta.recordingUrl === 'string' && meta.recordingUrl) {
      extra = (
        <>
          {extra}{' '}
          <a href={meta.recordingUrl} target="_blank" rel="noreferrer">
            {t('recording')}
          </a>
        </>
      );
    }
  } else {
    const by = nameOf(meta.by as string | undefined) || t('someone');
    const to = nameOf(meta.to as string | undefined);
    switch (meta.event) {
      case 'assigned':
        // Quien se lo toma a sí mismo: "se asignó el chat", como en la auditoría.
        text = meta.by && meta.by === meta.to ? t('assignedSelf', { by }) : t('assigned', { by, to });
        break;
      case 'unassigned':
        text = t('unassigned', { by });
        break;
      case 'auto_assigned':
        text = t('autoAssigned', { to, rule: String(meta.rule ?? '') });
        break;
      case 'reassigned_offline':
        text = t('reassignedOffline', { from: nameOf(meta.from as string | undefined) || t('someone'), to, rule: String(meta.rule ?? '') });
        break;
      case 'team':
        text = meta.team ? t('team', { by, team: String(meta.teamName ?? '') }) : t('noTeam', { by });
        break;
      case 'closed':
        text = t('closed', { by });
        break;
      case 'reopened':
        text = t('reopened', { by });
        break;
      default:
        return null;
    }
  }
  return (
    <p className={`gr-system${m.authorKind === 'call' ? ' gr-system-call' : ''}`} id={`m-${m.id}`}>
      {m.authorKind === 'call' && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
        </svg>
      )}
      <span>{text}</span>
      {extra}
      <time dateTime={m.createdAt}><LocalText>{time}</LocalText></time>
    </p>
  );
}

/** Mensajes fijados, arriba del hilo: clic va al mensaje, × lo desfija (la misma franja que Inbox). */
export function PinnedBar({
  pinned,
  onJump,
  onUnpin,
  textOf = (m) => m.body,
}: {
  pinned: MessageDto[];
  onJump: (m: MessageDto) => void;
  onUnpin: (m: MessageDto) => void;
  /** El texto con las menciones nombradas ("@Nombre" en lugar de "@<dígitos>"). */
  textOf?: (m: MessageDto) => string;
}) {
  const mediaText = useMediaText();
  return <SharedPinnedBar pinned={pinned} onJump={onJump} onUnpin={onUnpin} textOf={textOf} mediaOf={(m) => mediaText({ media: m.media })} />;
}

/** Reenviar un mensaje (o varios elegidos, en orden): buscar chats, marcar hasta 10 y mandar. */
export function ForwardModal({
  message: given,
  fromChatId,
  onClose,
  onDone,
  textOf = (m) => m.body,
}: {
  message: MessageDto | MessageDto[] | null;
  /** El texto con las menciones nombradas ("@Nombre" en lugar de "@<dígitos>"). */
  textOf?: (m: MessageDto) => string;
  fromChatId: string;
  onClose: () => void;
  onDone: (results: Array<{ chatId: string; name: string; ok: boolean; error?: string }>) => void;
}) {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const mediaText = useMediaText();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<ChatDto[] | null>(null);
  const [picked, setPicked] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const list = given == null ? [] : Array.isArray(given) ? given : [given];
  const message = list[0] ?? null;

  useEffect(() => {
    if (!message) return;
    setPicked(new Map());
    setError('');
    setQ('');
  }, [given]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!message) return;
    const id = setTimeout(async () => {
      const p = new URLSearchParams({ limit: '20' });
      if (q.trim()) p.set('q', q.trim());
      const res = await api<{ rows: ChatDto[] }>(`/api/groups/chats?${p}`);
      setRows((res.data?.rows ?? []).filter((r) => r.id !== fromChatId));
    }, 200);
    return () => clearTimeout(id);
  }, [q, given, fromChatId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit() {
    if (!message || picked.size === 0) return;
    setBusy(true);
    setError('');
    // Por chat: salió si salieron todos los mensajes (el primer error es el que se cuenta).
    const byChat = new Map<string, { chatId: string; name: string; ok: boolean; error?: string }>();
    for (const m of list) {
      const res = await api<{ results: Array<{ chatId: string; name: string; ok: boolean; error?: string }> }>(`/api/groups/messages/${m.id}`, {
        body: { action: 'forward', chatIds: [...picked.keys()] },
      });
      if (!res.data) {
        setBusy(false);
        setError(errText(res.error));
        return;
      }
      for (const r of res.data.results) if (!byChat.has(r.chatId) || (byChat.get(r.chatId)!.ok && !r.ok)) byChat.set(r.chatId, r);
    }
    setBusy(false);
    onDone([...byChat.values()]);
  }

  return (
    <Modal
      open={!!message}
      title={t('forward.title')}
      onClose={onClose}
      onSubmit={() => void submit()}
      busy={busy}
      foot={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={picked.size === 0} aria-busy={busy || undefined}>
            {picked.size > 0 ? t('forward.sendTo', { n: picked.size }) : t('forward.send')}
          </button>
        </>
      }
    >
      <div className="ui-fields">
        {list.length > 1 ? (
          <p className="gr-quote">{t('wa.messagesN', { n: list.length })}</p>
        ) : (
          message && <p className="gr-quote">{textOf(message).slice(0, 200) || mediaText({ media: message.media })}</p>
        )}
        <label className="ui-field">
          <span className="label">{t('forward.search')}</span>
          <span className="ui-search-box">
            <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} autoFocus data-clearable="" />
            <SearchClear shown={q !== ''} onClear={() => setQ('')} label={t('wa.clearSearch')} />
          </span>
        </label>
        {rows === null ? (
          <p className="ui-help" aria-busy="true">
            {t('common.loading')}
          </p>
        ) : rows.length === 0 ? (
          <p className="ui-help">{t('forward.empty')}</p>
        ) : (
          <ul className="gr-forward-list">
            {rows.map((r) => (
              <li key={r.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={picked.has(r.id)}
                    disabled={!picked.has(r.id) && picked.size >= MAX_FORWARD_TARGETS}
                    onChange={(e) =>
                      setPicked((prev) => {
                        const next = new Map(prev);
                        if (e.target.checked) next.set(r.id, r.name);
                        else next.delete(r.id);
                        return next;
                      })
                    }
                  />
                  <ChatPlate name={r.name} kind={r.kind} />
                  <span>{r.name}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <p className="ui-help">{t('forward.help', { n: MAX_FORWARD_TARGETS })}</p>
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
