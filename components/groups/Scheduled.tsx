'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import WhenDialog, { type WhenLabels } from '@/components/ui/WhenDialog';
import { longWhen } from '@/lib/when-presets';
import type { ScheduledMessageDto } from '@/lib/groups-broadcasts';
import { Modal, api, useErrorText, useToast, type ToastAction } from './ui';
import { ClockIcon } from './wa/icons';

type Toast = (msg: string, bad?: boolean, action?: ToastAction) => void;

/** Algo cambió en los programados (se programó, se canceló, salió): la tira del chat y la vista general se recargan. */
const CHANGED = 'zs:lines-scheduled';
export const notifyScheduledChanged = () => window.dispatchEvent(new Event(CHANGED));

/** Textos del selector de "cuándo" (components/ui/WhenDialog) para Lines. */
export function useWhenLabels(): WhenLabels {
  const t = useTranslations('groups.later');
  return useMemo(
    () => ({ preset: (p) => t(`preset.${p}`), custom: t('custom'), confirm: t('confirm'), cancel: t('cancel'), pastError: t('pastError') }),
    [t],
  );
}

/**
 * Los programados pendientes (de un chat o de todos). Se recargan cuando algo
 * cambia y, mientras haya alguno, cada tanto: seguido si alguno está por
 * salir, para que desaparezca de la tira cuando sale.
 */
function useScheduled(query: string) {
  const [items, setItems] = useState<ScheduledMessageDto[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    const r = await api<{ scheduled: ScheduledMessageDto[] }>(`/api/groups/broadcasts?view=scheduled${query}`);
    if (r.data) {
      setItems(r.data.scheduled ?? []);
      setFailed(false);
    } else setFailed(true);
  }, [query]);
  useEffect(() => {
    void load();
    const on = () => void load();
    window.addEventListener(CHANGED, on);
    return () => window.removeEventListener(CHANGED, on);
  }, [load]);
  const count = items?.length ?? 0;
  const soon = Boolean(items?.some((i) => i.status === 'sending' || Date.parse(i.scheduledAt) <= Date.now() + 60_000));
  useEffect(() => {
    if (!count) return;
    // Solo con la pestaña a la vista; al volver a ella, al día en el acto.
    const tick = () => {
      if (document.visibilityState === 'visible') void load();
    };
    const id = setInterval(tick, soon ? 5000 : 30_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [count, soon, load]);
  return { items, failed, load };
}

/**
 * La lista de programados con sus acciones: enviar ahora, cambiar la hora,
 * editar el texto y cancelar. `showChat` suma el chat de cada uno (la vista
 * de todos los chats).
 */
function ScheduledList({
  items,
  showChat = false,
  onToast,
  onReload,
  onNavigate,
}: {
  items: ScheduledMessageDto[];
  showChat?: boolean;
  onToast: Toast;
  onReload: () => void;
  onNavigate?: () => void;
}) {
  const t = useTranslations('groups.later');
  const locale = useLocale();
  const errText = useErrorText();
  const labels = useWhenLabels();
  const [busy, setBusy] = useState('');
  const [retime, setRetime] = useState<ScheduledMessageDto | null>(null);
  const [edit, setEdit] = useState<{ item: ScheduledMessageDto; body: string; error: string } | null>(null);
  const [cancel, setCancel] = useState<ScheduledMessageDto | null>(null);

  /** PATCH al programado; avisa a las demás vistas. Devuelve si salió bien. */
  const patch = async (id: string, body: Record<string, unknown>, done: string): Promise<string | null> => {
    setBusy(id);
    const r = await api(`/api/groups/broadcasts/${id}`, { method: 'PATCH', body });
    setBusy('');
    notifyScheduledChanged();
    onReload();
    if (r.error) return r.error;
    onToast(done);
    return null;
  };
  const run = async (id: string, body: Record<string, unknown>, done: string) => {
    const error = await patch(id, body, done);
    if (error) onToast(errText(error), true);
  };

  return (
    <>
      <ul className="gr-later-list">
        {items.map((s) => {
          const sending = s.status === 'sending';
          const off = sending || busy === s.id;
          return (
            <li key={s.id} className="gr-later-item" data-testid="lines-scheduled-item">
              <div className="gr-later-main">
                <p className="gr-later-head">
                  <span className="gr-later-when">
                    <ClockIcon size={14} /> {sending ? t('sending') : t('at', { when: longWhen(s.scheduledAt, locale) })}
                  </span>
                  {showChat && (
                    <Link href={`/app/lines/inbox/${s.chat.id}`} className="gr-later-chat" aria-label={t('openChat', { name: s.chat.name })} onClick={onNavigate}>
                      {s.chat.name}
                    </Link>
                  )}
                  {s.otherChats > 0 && <span className="gr-later-tag">{t('others', { n: s.otherChats })}</span>}
                  {s.replyToId && <span className="gr-later-tag">{t('tagReply')}</span>}
                  {s.media && <span className="gr-later-tag">{t('tagFile', { name: s.media.name })}</span>}
                  {s.poll && <span className="gr-later-tag">{t('tagPoll')}</span>}
                  {s.recurringId && <span className="gr-later-tag">{t('tagRepeats')}</span>}
                </p>
                {s.body && <p className="gr-later-body">{s.body}</p>}
              </div>
              <div className="gr-later-actions">
                <button type="button" className="btn btn-ghost btn-sm" disabled={off} onClick={() => void run(s.id, { action: 'send_now' }, t('sentNow'))}>
                  {t('sendNow')}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={off} onClick={() => setRetime(s)}>
                  {t('changeTime')}
                </button>
                {!s.poll && (
                  <button type="button" className="btn btn-ghost btn-sm" disabled={off} onClick={() => setEdit({ item: s, body: s.body, error: '' })}>
                    {t('edit')}
                  </button>
                )}
                <button type="button" className="btn btn-ghost btn-sm" disabled={off} onClick={() => setCancel(s)}>
                  {t('cancelItem')}
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <WhenDialog
        open={!!retime}
        title={t('changeTitle')}
        labels={labels}
        initial={retime?.scheduledAt}
        help={retime?.body ? <span className="gr-later-preview">{retime.body.slice(0, 200)}</span> : undefined}
        onClose={() => setRetime(null)}
        onPick={(iso) => {
          const item = retime;
          setRetime(null);
          if (item) void run(item.id, { scheduledAt: iso }, t('toast', { when: longWhen(iso, locale) }));
        }}
      />

      <Modal
        open={!!edit}
        title={t('editTitle')}
        onClose={() => setEdit(null)}
        busy={!!edit && busy === edit.item.id}
        onSubmit={() => {
          if (!edit) return;
          const body = edit.body.trim();
          if (!body && !edit.item.media) return setEdit({ ...edit, error: errText('empty_message') });
          void patch(edit.item.id, { body }, t('saved')).then((error) => (error ? setEdit((e) => (e ? { ...e, error: errText(error) } : e)) : setEdit(null)));
        }}
        foot={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setEdit(null)}>
              {t('cancel')}
            </button>
            <button type="submit" className="btn btn-primary" aria-busy={(!!edit && busy === edit.item.id) || undefined}>
              {t('save')}
            </button>
          </>
        }
      >
        {edit && (
          <div className="ui-fields">
            <p className="ui-help">
              <ClockIcon size={14} /> {t('at', { when: longWhen(edit.item.scheduledAt, locale) })}
            </p>
            <label className="ui-field">
              <span className="label">{t('editLabel')}</span>
              <textarea className="textarea" rows={5} maxLength={4096} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value, error: '' })} autoFocus />
            </label>
            {edit.error && (
              <p className="ui-error" role="alert">
                {edit.error}
              </p>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!cancel}
        title={t('cancelTitle')}
        body={
          <>
            {cancel?.body && <span className="gr-later-preview">{cancel.body.slice(0, 200)}</span>} {t('cancelBody')}
          </>
        }
        confirmLabel={t('cancelConfirm')}
        cancelLabel={t('keep')}
        danger
        onCancel={() => setCancel(null)}
        onConfirm={() => {
          const item = cancel;
          setCancel(null);
          if (item) void run(item.id, { action: 'cancel' }, t('cancelled'));
        }}
      />
    </>
  );
}

/**
 * Debajo de la conversación, arriba del campo: lo que está programado para
 * este chat, con sus acciones. No ocupa lugar si no hay nada.
 */
export function ScheduledStrip({ chatId, onToast }: { chatId: string; onToast: Toast }) {
  const t = useTranslations('groups.later');
  const { items, load } = useScheduled(`&chat=${encodeURIComponent(chatId)}`);
  if (!items?.length) return null;
  return (
    <section className="gr-later-strip" aria-label={t('strip')} data-testid="lines-scheduled-strip">
      <ScheduledList items={items} onToast={onToast} onReload={() => void load()} />
    </section>
  );
}

/**
 * En la lista de chats: el reloj que abre todos los mensajes programados, de
 * cualquier chat, para que ninguno quede olvidado. Con un punto si la persona
 * tiene alguno pendiente.
 */
export function ScheduledAllButton() {
  const t = useTranslations('groups.later');
  const tc = useTranslations('groups.common');
  const [open, setOpen] = useState(false);
  const [mineOnly, setMineOnly] = useState(true);
  const [toast, showToast] = useToast();
  const { items, failed, load } = useScheduled('');
  const mine = useMemo(() => (items ?? []).filter((i) => i.mine), [items]);
  const shown = mineOnly ? mine : (items ?? []);
  const label = mine.length ? t('allCount', { n: mine.length }) : t('all');
  return (
    <>
      <button
        type="button"
        className={`wa-icon-btn wa-filter-btn${open ? ' is-on' : ''}`}
        data-testid="lines-scheduled-all"
        aria-label={label}
        title={label}
        onClick={() => {
          setOpen(true);
          void load();
        }}
      >
        <ClockIcon size={20} />
        {mine.length > 0 && <span className="wa-filter-dot" aria-hidden="true" />}
      </button>
      <Modal
        open={open}
        title={t('all')}
        onClose={() => setOpen(false)}
        wide
        foot={
          <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
            {t('close')}
          </button>
        }
      >
        <div className="gr-later-all">
          <label className="gr-check-label">
            <input type="checkbox" className="ui-check" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
            {t('mineOnly')}
          </label>
          {items === null && !failed ? (
            <p className="ui-help">{tc('loading')}</p>
          ) : failed && items === null ? (
            <p className="ui-error" role="alert">
              {t('loadError')}{' '}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load()}>
                {t('retry')}
              </button>
            </p>
          ) : shown.length === 0 ? (
            <p className="ui-help gr-later-empty">{mineOnly ? t('allEmptyMine') : t('allEmpty')}</p>
          ) : (
            <ScheduledList items={shown} showChat onToast={showToast} onReload={() => void load()} onNavigate={() => setOpen(false)} />
          )}
        </div>
        {toast}
      </Modal>
    </>
  );
}
