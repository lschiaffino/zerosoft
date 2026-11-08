'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { RecVideoDto } from '@/lib/rec';
import type { RecAccessRequestDto } from '@/lib/rec-admin';
import type { RecPersonDto } from '@/lib/rec-share';
import { cleanEmails, type RecPrivacy, type RecRole } from '@/lib/rec-schema';
import RecCopy from './RecCopy';

function toLocalInput(db: string | null): string {
  if (!db) return '';
  const d = new Date(`${db.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type Member = { name: string; email: string };

/**
 * Compartir (como Drive y Loom): invitar personas por email con rol (mira o
 * comenta), lista de quién tiene acceso con quitar, pedidos de acceso,
 * acceso general (restringido, workspace o cualquiera con el link), opciones
 * del link (contraseña, vencimiento, pedir email), descargas, comentarios,
 * avisos, link para insertar y cambiar el link. Las personas se guardan al
 * toque; el acceso general y las opciones, con Guardar.
 */
export default function RecShareDialog({
  open,
  video,
  shareUrl,
  onClose,
  onSave,
  onRotate,
  onVideo,
}: {
  open: boolean;
  video: RecVideoDto;
  shareUrl: string;
  onClose: () => void;
  onSave: (patch: Record<string, unknown>) => Promise<boolean>;
  onRotate: () => Promise<boolean>;
  onVideo: (patch: Partial<RecVideoDto>) => void;
}) {
  const t = useTranslations('rec.share');
  const tc = useTranslations('rec.common');
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const locale = useLocale();
  const [privacy, setPrivacy] = useState<RecPrivacy>(video.privacy);
  const [password, setPassword] = useState('');
  const [removePw, setRemovePw] = useState(false);
  const [expires, setExpires] = useState(toLocalInput(video.expiresAt));
  const [allowDownload, setAllowDownload] = useState(video.allowDownload);
  const [allowComments, setAllowComments] = useState(video.allowComments);
  const [notify, setNotify] = useState(video.notify);
  const [requireAccount, setRequireAccount] = useState(video.commentsRequireAccount);
  const [requireEmail, setRequireEmail] = useState(video.requireEmail);
  const [busy, setBusy] = useState(false);
  const [requests, setRequests] = useState<RecAccessRequestDto[]>([]);
  const [rotating, setRotating] = useState(false);
  // Personas: se guardan al toque.
  const [people, setPeople] = useState<RecPersonDto[] | null>(null);
  const [peopleError, setPeopleError] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [draft, setDraft] = useState('');
  const [role, setRole] = useState<RecRole>('commenter');
  const [sendMail, setSendMail] = useState(true);
  const [adding, setAdding] = useState(false);
  const [addMsg, setAddMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const loadPeople = useCallback(async () => {
    setPeopleError(false);
    const res = await fetch(`/api/rec/videos/${video.id}/people`).catch(() => null);
    if (!res?.ok) {
      setPeopleError(true);
      setPeople([]);
      return;
    }
    const data = (await res.json()) as { people: RecPersonDto[]; members: Member[] };
    setPeople(data.people);
    setMembers(data.members);
  }, [video.id]);

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
      setRequireEmail(video.requireEmail);
      setDraft('');
      setAddMsg(null);
      setPeople(null);
      if (video.canManage) {
        void loadPeople();
        void fetch(`/api/rec/videos/${video.id}/requests`)
          .then((r) => (r.ok ? (r.json() as Promise<{ requests: RecAccessRequestDto[] }>) : null))
          .then((x) => setRequests(x?.requests ?? []))
          .catch(() => setRequests([]));
      }
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open, video, loadPeople]);

  const embedUrl = `${shareUrl}/embed`;
  const embed = `<iframe src="${embedUrl}" width="640" height="400" frameborder="0" allow="fullscreen" allowfullscreen title="${video.title.replace(/"/g, '&quot;')}"></iframe>`;
  const personal = video.space === 'personal';
  const inSpace = !!video.spaceId;

  function syncEmails(list: RecPersonDto[]) {
    onVideo({ allowedEmails: list.map((p) => p.email), peopleRoles: Object.fromEntries(list.map((p) => [p.email, p.role])) });
  }

  async function decide(r: RecAccessRequestDto, approve: boolean) {
    const res = await fetch(`/api/rec/videos/${video.id}/requests/${r.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ approve, locale }),
    }).catch(() => null);
    if (!res?.ok) return;
    setRequests((prev) => prev.filter((x) => x.id !== r.id));
    if (approve) await loadPeople();
    const { allowedEmails } = (await res.json()) as { allowedEmails: string[] };
    onVideo({ allowedEmails });
  }

  async function add() {
    const emails = cleanEmails(draft);
    if (!emails.length) {
      setAddMsg({ kind: 'error', text: t('addInvalid') });
      return;
    }
    setAdding(true);
    setAddMsg(null);
    const res = await fetch(`/api/rec/videos/${video.id}/people`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ emails: draft.split(/[\s,;]+/).filter(Boolean), role, notify: sendMail, locale }),
    }).catch(() => null);
    setAdding(false);
    if (!res?.ok) {
      const code = res ? ((await res.json().catch(() => ({}))) as { error?: string }).error : null;
      setAddMsg({ kind: 'error', text: code === 'allowed_full' ? t('addFull') : code === 'invalid_email' ? t('addInvalid') : code === 'invite_quota' ? t('addQuota') : t('addError') });
      return;
    }
    const data = (await res.json()) as { people: RecPersonDto[]; added: string[]; sent: number };
    setPeople(data.people);
    syncEmails(data.people);
    setDraft('');
    setAddMsg({ kind: 'ok', text: data.sent ? t('addedSent', { n: data.sent }) : t('added', { n: data.added.length }) });
  }

  async function changeRole(p: RecPersonDto, next: RecRole) {
    setPeople((prev) => prev?.map((x) => (x.email === p.email ? { ...x, role: next } : x)) ?? prev);
    const res = await fetch(`/api/rec/videos/${video.id}/people`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: p.email, role: next }),
    }).catch(() => null);
    if (!res?.ok) {
      setAddMsg({ kind: 'error', text: t('addError') });
      await loadPeople();
      return;
    }
    const data = (await res.json()) as { people: RecPersonDto[] };
    setPeople(data.people);
    syncEmails(data.people);
  }

  async function remove(email: string) {
    setRemoving(email);
    const res = await fetch(`/api/rec/videos/${video.id}/people?email=${encodeURIComponent(email)}`, { method: 'DELETE' }).catch(() => null);
    setRemoving(null);
    if (!res?.ok) {
      setAddMsg({ kind: 'error', text: t('addError') });
      return;
    }
    const data = (await res.json()) as { people: RecPersonDto[] };
    setPeople(data.people);
    syncEmails(data.people);
  }

  async function save() {
    const patch: Record<string, unknown> = {
      privacy,
      expiresAt: expires ? new Date(expires).toISOString() : null,
      allowDownload,
      allowComments,
      notify,
      commentsRequireAccount: requireAccount,
      requireEmail,
    };
    if (password) patch.password = password;
    else if (removePw) patch.password = null;
    setBusy(true);
    const ok = await onSave(patch);
    setBusy(false);
    if (ok) onClose();
  }

  const accessHelp =
    privacy === 'people' ? t('accessPeopleHelp') : privacy === 'workspace' ? (inSpace ? t('accessSpaceHelp') : t('accessWorkspaceHelp')) : t('accessLinkHelp');

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
            <h2 className="ui-modal-title rec-share-title" id={`${id}-t`}>
              {t('titleOf', { title: video.title })}
            </h2>
          </div>
          <div className="ui-modal-body rec-share-body">
            {video.canManage && (
              <section className="rec-share-group" aria-labelledby={`${id}-add-l`}>
                <label className="label" id={`${id}-add-l`} htmlFor={`${id}-add`}>
                  {t('addPeople')}
                </label>
                <div className="rec-share-add">
                  <input
                    id={`${id}-add`}
                    className="input"
                    type="text"
                    inputMode="email"
                    list={`${id}-members`}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (draft.trim()) void add();
                      }
                    }}
                    placeholder={t('addPlaceholder')}
                    autoComplete="off"
                    data-testid="rec-share-add-input"
                  />
                  <datalist id={`${id}-members`}>
                    {members.map((m) => (
                      <option key={m.email} value={m.email}>
                        {m.name}
                      </option>
                    ))}
                  </datalist>
                  <select className="select" aria-label={t('role')} value={role} onChange={(e) => setRole(e.target.value as RecRole)} data-testid="rec-share-add-role">
                    <option value="commenter">{t('roleCommenter')}</option>
                    <option value="viewer">{t('roleViewer')}</option>
                  </select>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => void add()} disabled={adding || !draft.trim()} aria-busy={adding || undefined} data-testid="rec-share-add">
                    {t('invite')}
                  </button>
                </div>
                <label className="ui-check">
                  <input type="checkbox" checked={sendMail} onChange={(e) => setSendMail(e.target.checked)} data-testid="rec-share-send-mail" />
                  <span>{t('sendMail')}</span>
                </label>
                {addMsg && (
                  <p className={addMsg.kind === 'error' ? 'ui-error' : 'ui-help'} role={addMsg.kind === 'error' ? 'alert' : 'status'} data-testid="rec-share-add-msg">
                    {addMsg.text}
                  </p>
                )}
              </section>
            )}

            {requests.length > 0 && (
              <div className="rec-share-group" data-testid="rec-share-requests">
                <p className="label">{t('requests')}</p>
                <ul className="rec-requests">
                  {requests.map((r) => (
                    <li key={r.id} className="rec-request">
                      <span className="rec-request-who">{r.name ? `${r.name} · ${r.email}` : r.email}</span>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => void decide(r, false)} data-testid="rec-request-deny">
                        {t('deny')}
                      </button>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => void decide(r, true)} data-testid="rec-request-approve">
                        {t('approve')}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {video.canManage && (
              <section className="rec-share-group" aria-labelledby={`${id}-people-l`}>
                <p className="label" id={`${id}-people-l`}>
                  {t('peopleWithAccess')}
                </p>
                <ul className="rec-people" data-testid="rec-share-people-list" aria-busy={people === null || undefined}>
                  <li className="rec-person">
                    <span className="rec-person-avatar" aria-hidden="true">
                      {(video.authorName || '?').slice(0, 1).toUpperCase()}
                    </span>
                    <span className="rec-person-who">
                      <span className="rec-person-name">{video.authorName || t('owner')}</span>
                    </span>
                    <span className="rec-person-role muted">{t('owner')}</span>
                  </li>
                  {people === null && <li className="rec-person muted">{t('loadingPeople')}</li>}
                  {peopleError && (
                    <li className="rec-person">
                      <span className="ui-error">{t('peopleError')}</span>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadPeople()}>
                        {t('retry')}
                      </button>
                    </li>
                  )}
                  {people?.map((p) => (
                    <li key={p.email} className="rec-person" data-testid="rec-share-person" data-email={p.email}>
                      <span className="rec-person-avatar" aria-hidden="true">
                        {(p.name || p.email).slice(0, 1).toUpperCase()}
                      </span>
                      <span className="rec-person-who">
                        <span className="rec-person-name">{p.name || p.email}</span>
                        <span className="rec-person-meta muted">
                          {p.name ? `${p.email} · ` : ''}
                          {p.member ? `${t('member')} · ` : ''}
                          {p.viewedAt ? t('viewed') : t('notViewed')}
                        </span>
                      </span>
                      <select
                        className="select rec-person-role"
                        aria-label={t('roleFor', { email: p.email })}
                        value={p.role}
                        onChange={(e) => void changeRole(p, e.target.value as RecRole)}
                        data-testid="rec-share-person-role"
                      >
                        <option value="commenter">{t('roleCommenter')}</option>
                        <option value="viewer">{t('roleViewer')}</option>
                      </select>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => void remove(p.email)}
                        disabled={removing === p.email}
                        aria-label={t('removeFor', { email: p.email })}
                        data-testid="rec-share-remove"
                      >
                        {t('remove')}
                      </button>
                    </li>
                  ))}
                  {people && !peopleError && people.length === 0 && <li className="rec-person muted rec-person-empty">{t('noPeople')}</li>}
                </ul>
              </section>
            )}

            <div className="ui-field">
              <label className="label" htmlFor={`${id}-access`}>
                {t('generalAccess')}
              </label>
              <select
                id={`${id}-access`}
                className="select"
                value={privacy}
                onChange={(e) => setPrivacy(e.target.value as RecPrivacy)}
                disabled={!video.canManage}
                data-testid="rec-share-access"
              >
                {personal && <option value="people">{t('accessPeople')}</option>}
                <option value="workspace">{inSpace ? t('accessSpace') : t('accessWorkspace')}</option>
                <option value="link">{t('accessLink')}</option>
              </select>
              <p className="ui-help" data-testid="rec-share-access-help">
                {accessHelp}
              </p>
              {!personal && <p className="ui-help">{t('peopleNeedsPersonal')}</p>}
            </div>

            {privacy !== 'people' && (
              <fieldset className="rec-share-group">
                <legend className="label">{t('linkOptions')}</legend>
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
                    <input id={`${id}-exp`} className="input" type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} data-testid="rec-share-expires" />
                    <p className="ui-help">{t('expiresHelp')}</p>
                  </div>
                </div>
                {privacy === 'link' && (
                  <>
                    <label className="ui-check">
                      <input type="checkbox" checked={requireEmail} onChange={(e) => setRequireEmail(e.target.checked)} data-testid="rec-share-require-email" />
                      <span>{t('requireEmail')}</span>
                    </label>
                    <p className="ui-help">{t('requireEmailHelp')}</p>
                  </>
                )}
                <p className="ui-help">{t('invitedSkip')}</p>
              </fieldset>
            )}

            <fieldset className="rec-share-group">
              <legend className="label">{t('options')}</legend>
              <label className="ui-check">
                <input type="checkbox" checked={allowDownload} onChange={(e) => setAllowDownload(e.target.checked)} data-testid="rec-share-download" />
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

            <details className="rec-share-more">
              <summary>{t('embedAndLink')}</summary>
              <div className="rec-share-group">
                <div className="ui-field">
                  <label className="label" htmlFor={`${id}-embed`}>
                    {t('embed')}
                  </label>
                  <div className="ui-input-group">
                    <input id={`${id}-embed`} className="input data" value={embed} readOnly onFocus={(e) => e.currentTarget.select()} />
                    <RecCopy text={embed} label={t('copyEmbed')} />
                  </div>
                  <p className="ui-help">{t('embedHelp')}</p>
                </div>
                {video.canManage && (
                  <div className="rec-share-group">
                    <p className="label">{t('rotate')}</p>
                    <p className="ui-help">{t('rotateHelp')}</p>
                    <div>
                      <button type="button" className="btn btn-ghost btn-danger btn-sm" onClick={() => setRotating(true)} data-testid="rec-share-rotate">
                        {t('rotateGo')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </details>
          </div>
          <div className="ui-modal-foot rec-share-foot">
            <div className="rec-share-copy">
              <RecCopy text={shareUrl} label={t('copyLink')} testId="rec-share-copy" />
            </div>
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
      <ConfirmDialog
        open={rotating}
        title={t('rotateTitle')}
        body={t('rotateBody')}
        confirmLabel={t('rotateGo')}
        cancelLabel={tc('cancel')}
        danger
        busy={busy}
        onConfirm={async () => {
          setBusy(true);
          await onRotate();
          setBusy(false);
          setRotating(false);
        }}
        onCancel={() => setRotating(false)}
      />
    </dialog>
  );
}
