'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useChatDisplay } from '@/components/chat-style/ChatStyle';
import { cleanInviteTitle } from '@/lib/wa-invite';
import Avatar from './Avatar';
import { fetchPreview, fromGiven, needsFetch, pickPreview, safeImage, type LinkPreviewData } from './link-preview-data';

/** Lo que devuelve entrar al grupo: el chat nuevo, o el código del error. */
export type InviteJoinResult = { ok: true; id: string; name?: string } | { ok: false; code: string };

export interface InviteJoin {
  /** Nombre de la línea o la cuenta con la que se entra (va en la confirmación; '' si es la única cuenta). */
  lineName: string;
  run: () => Promise<InviteJoinResult>;
  /** Abre el chat del grupo después de entrar. */
  onOpen?: (id: string) => void;
}

/** Los errores que se explican; el resto es "no se pudo". */
const KNOWN_ERRORS = new Set(['invite_invalid', 'invite_already_member', 'invite_approval_required', 'not_connected', 'groups_unsupported', 'rate_limited', 'join_no_access']);

/**
 * Invitación a un grupo de WhatsApp, como la tarjeta de WhatsApp: la foto del
 * grupo redonda (entera, nunca recortada en una columna), el nombre, "Invitación
 * a grupo de WhatsApp" y los botones. "Unirme al grupo" entra con la línea del
 * chat (o la cuenta de Inbox) después de confirmar, porque entrar se ve en el
 * grupo; "Abrir en WhatsApp" abre el link en otra pestaña.
 *
 * Los datos salen de la vista previa (la que vino con el mensaje o la que lee
 * el servidor); sin vista previa la tarjeta igual se ve, con el ícono de grupo.
 */
export default function InviteCard({ url, given, join }: { url: string; given?: LinkPreviewData | null; join?: InviteJoin }) {
  const t = useTranslations('groups.wa.invite');
  const { linkPreviews } = useChatDisplay();
  const base = useMemo(() => fromGiven(given), [given]);
  const [fetched, setFetched] = useState<LinkPreviewData | null>(null);
  const wantFetch = linkPreviews !== 'off' && needsFetch(base, 'large');
  useEffect(() => {
    setFetched(null);
    if (!wantFetch) return;
    let alive = true;
    void fetchPreview(url).then((d) => alive && setFetched(d));
    return () => {
      alive = false;
    };
  }, [url, wantFetch]);
  const data = pickPreview(base, fetched);
  const name = cleanInviteTitle(data?.title);
  const image = linkPreviews === 'off' ? '' : safeImage(data?.image);

  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState('');

  async function confirmJoin() {
    if (!join || busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await join.run();
      if (r.ok) setDone({ id: r.id, name: r.name || name });
      else setError(KNOWN_ERRORS.has(r.code) ? r.code : 'failed');
    } catch {
      setError('failed');
    } finally {
      setBusy(false);
      setAsking(false);
    }
  }

  const shown = name || t('unnamed');
  return (
    <div className="wa-invite" data-testid="wa-invite-card">
      <div className="wa-invite-head">
        <span className="wa-invite-photo">
          <Avatar name={shown} kind="group" src={image || undefined} size={52} eager />
        </span>
        <span className="wa-invite-text">
          <strong dir="auto" data-testid="wa-invite-name">
            {shown}
          </strong>
          <span className="wa-invite-sub" data-testid="wa-invite-subtitle">
            {t('subtitle')}
          </span>
        </span>
      </div>
      {(done || error) && (
        <p className={`wa-invite-status${error ? ' is-error' : ''}`} role="status" data-testid="wa-invite-status" data-state={error ? 'error' : 'joined'}>
          {done ? t('joined', { name: done.name || t('unnamed') }) : t(`errors.${error}`)}
        </p>
      )}
      <div className="wa-invite-actions">
        {join && !done && error !== 'invite_already_member' && error !== 'join_no_access' && (
          <button type="button" data-testid="wa-invite-join" onClick={() => setAsking(true)} disabled={busy} aria-busy={busy}>
            {busy ? t('joining') : t('join')}
          </button>
        )}
        {done && join?.onOpen && (
          <button type="button" data-testid="wa-invite-open-chat" onClick={() => join.onOpen?.(done.id)}>
            {t('openGroup')}
          </button>
        )}
        <a href={url} target="_blank" rel="noopener noreferrer nofollow" data-testid="wa-invite-open">
          {t('openInWhatsapp')}
        </a>
      </div>
      {join && (
        <ConfirmDialog
          open={asking}
          title={join.lineName ? t('confirmTitle', { name: shown, line: join.lineName }) : t('confirmTitleAccount', { name: shown })}
          body={t('confirmBody')}
          confirmLabel={t('join')}
          cancelLabel={t('cancel')}
          busy={busy}
          onConfirm={() => void confirmJoin()}
          onCancel={() => setAsking(false)}
        />
      )}
    </div>
  );
}
