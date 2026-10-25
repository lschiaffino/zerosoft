'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { RecVideoDto } from '@/lib/rec';
import RecCopy from './RecCopy';

function toLocalInput(db: string | null): string {
  if (!db) return '';
  const d = new Date(`${db.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Compartir (como el modal de Loom): link y código para insertar con copia
 * rápida, quién lo ve (cualquiera con el link o solo el workspace),
 * contraseña, vencimiento, descargas, comentarios y avisos.
 */
export default function RecShareDialog({
  open,
  video,
  shareUrl,
  onClose,
  onSave,
}: {
  open: boolean;
  video: RecVideoDto;
  shareUrl: string;
  onClose: () => void;
  onSave: (patch: Record<string, unknown>) => Promise<boolean>;
}) {
  const t = useTranslations('rec.share');
  const tc = useTranslations('rec.common');
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [privacy, setPrivacy] = useState(video.privacy);
  const [password, setPassword] = useState('');
  const [removePw, setRemovePw] = useState(false);
  const [expires, setExpires] = useState(toLocalInput(video.expiresAt));
  const [allowDownload, setAllowDownload] = useState(video.allowDownload);
  const [allowComments, setAllowComments] = useState(video.allowComments);
  const [notify, setNotify] = useState(video.notify);
  const [requireAccount, setRequireAccount] = useState(video.commentsRequireAccount);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setPrivacy(video.privacy);
      setPassword('');
      setRemovePw(false);
      setExpires(toLocalInput(video.expiresAt));
      setAllowDownload(video.allowDownload);
      setAllowComments(video.allowComments);
      setNotify(video.notify);
      setRequireAccount(video.commentsRequireAccount);
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open, video]);

  const embedUrl = `${shareUrl}/embed`;
  const embed = `<iframe src="${embedUrl}" width="640" height="400" frameborder="0" allow="fullscreen" allowfullscreen title="${video.title.replace(/"/g, '&quot;')}"></iframe>`;

  async function save() {
    const patch: Record<string, unknown> = {
      privacy,
      expiresAt: expires ? new Date(expires).toISOString() : null,
      allowDownload,
      allowComments,
      notify,
      commentsRequireAccount: requireAccount,
    };
    if (password) patch.password = password;
    else if (removePw) patch.password = null;
    setBusy(true);
    const ok = await onSave(patch);
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <dialog
      ref={ref}
      className="ui-modal rec-share"
      aria-labelledby={`${id}-t`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="ui-modal-head">
            <h2 className="ui-modal-title" id={`${id}-t`}>
              {t('title')}
            </h2>
          </div>
          <div className="ui-modal-body rec-share-body">
            <div className="ui-field">
              <label className="label" htmlFor={`${id}-link`}>
                {t('link')}
              </label>
              <div className="ui-input-group">
                <input id={`${id}-link`} className="input data" value={shareUrl} readOnly onFocus={(e) => e.currentTarget.select()} />
                <RecCopy text={shareUrl} label={t('copyLink')} testId="rec-share-copy" />
              </div>
            </div>
            <div className="ui-field">
              <label className="label" htmlFor={`${id}-embed`}>
                {t('embed')}
              </label>
              <div className="ui-input-group">
                <input id={`${id}-embed`} className="input data" value={embed} readOnly onFocus={(e) => e.currentTarget.select()} />
                <RecCopy text={embed} label={t('copyEmbed')} />
              </div>
            </div>
            <fieldset className="rec-share-group">
              <legend className="label">{t('who')}</legend>
              <label className="ui-check">
                <input type="radio" name={`${id}-p`} checked={privacy === 'link'} onChange={() => setPrivacy('link')} />
                <span>{t('anyone')}</span>
              </label>
              <label className="ui-check">
                <input type="radio" name={`${id}-p`} checked={privacy === 'workspace'} onChange={() => setPrivacy('workspace')} />
                <span>{t('workspaceOnly')}</span>
              </label>
            </fieldset>
            <div className="ui-fields ui-fields-2">
              <div className="ui-field">
                <label className="label" htmlFor={`${id}-pw`}>
                  {video.hasPassword ? t('changePassword') : t('password')}
                </label>
                <input
                  id={`${id}-pw`}
                  className="input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={200}
                  placeholder={video.hasPassword ? t('passwordSet') : ''}
                  disabled={privacy === 'workspace'}
                />
                <p className="ui-help">{t('passwordHelp')}</p>
                {video.hasPassword && (
                  <label className="ui-check">
                    <input type="checkbox" checked={removePw} onChange={(e) => setRemovePw(e.target.checked)} />
                    <span>{t('removePassword')}</span>
                  </label>
                )}
              </div>
              <div className="ui-field">
                <label className="label" htmlFor={`${id}-exp`}>
                  {t('expires')}
                </label>
                <input id={`${id}-exp`} className="input" type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} />
                <p className="ui-help">{t('expiresHelp')}</p>
              </div>
            </div>
            <fieldset className="rec-share-group">
              <legend className="label">{t('options')}</legend>
              <label className="ui-check">
                <input type="checkbox" checked={allowDownload} onChange={(e) => setAllowDownload(e.target.checked)} />
                <span>{t('allowDownload')}</span>
              </label>
              <p className="ui-help">{t('downloadNote')}</p>
              <label className="ui-check">
                <input type="checkbox" checked={allowComments} onChange={(e) => setAllowComments(e.target.checked)} />
                <span>{t('allowComments')}</span>
              </label>
              <label className="ui-check">
                <input type="checkbox" checked={requireAccount} onChange={(e) => setRequireAccount(e.target.checked)} disabled={!allowComments} />
                <span>{t('requireAccount')}</span>
              </label>
              <label className="ui-check">
                <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
                <span>{t('notify')}</span>
              </label>
            </fieldset>
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-sm" onClick={onClose}>
              {tc('cancel')}
            </button>
            {video.canManage && (
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy} aria-busy={busy || undefined} data-testid="rec-share-save">
                {tc('save')}
              </button>
            )}
          </div>
        </form>
      )}
    </dialog>
  );
}
