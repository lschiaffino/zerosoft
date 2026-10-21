'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { BoardAccessLevel, BoardAccessMember, BoardAccessMode, BoardMemberRole } from '@/lib/board-access';
import type { BoardMember } from '@/lib/board-comments';

interface AccessState {
  mode: BoardAccessMode;
  level: BoardAccessLevel;
  created_by: string | null;
  members: BoardAccessMember[];
  candidates: BoardMember[];
  guest_token: string | null;
}

/**
 * Acceso por pizarra (dentro del popover de compartir): todo el workspace o
 * solo invitados con rol, y el link de invitado con edición. Quien no la
 * gestiona ve cómo está configurada, sin poder cambiarla.
 */
export default function BoardAccessPanel({ boardId, onModeChange }: { boardId: string; onModeChange?: (mode: BoardAccessMode) => void }) {
  const t = useTranslations('board.access');
  const [state, setState] = useState<AccessState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [pick, setPick] = useState('');
  const [pickRole, setPickRole] = useState<BoardMemberRole>('edit');
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/boards/${boardId}/access`).catch(() => null);
    if (res?.ok) setState((await res.json()) as AccessState);
    else setError(true);
  }, [boardId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(false);
    try {
      const res = await fetch(`/api/boards/${boardId}/access`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(String(res.status));
      const next = (await res.json()) as AccessState;
      setState(next);
      onModeChange?.(next.mode);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  if (!state) {
    return error ? (
      <p className="ui-error" role="alert">
        {t('error')}
      </p>
    ) : (
      <p className="board-pop-hint" role="status">
        {t('loading')}
      </p>
    );
  }

  const manage = state.level === 'manage';
  const invited = new Set(state.members.map((m) => m.id));
  const options = state.candidates.filter((c) => !invited.has(c.id) && c.id !== state.created_by);
  const guestUrl = state.guest_token && typeof window !== 'undefined' ? `${window.location.origin}/b/e/${state.guest_token}` : '';

  return (
    <div className="board-pop-section board-access">
      <p className="board-pop-title">{t('title')}</p>
      {manage ? (
        <div className="board-access-modes" role="radiogroup" aria-label={t('title')}>
          {(['workspace', 'restricted'] as const).map((m) => (
            <label key={m} className="board-access-mode">
              <input
                type="radio"
                name={`board-access-${boardId}`}
                checked={state.mode === m}
                disabled={busy}
                onChange={() => void patch({ mode: m })}
              />
              <span>
                <span className="board-access-mode-name">{t(`modes.${m}`)}</span>
                <span className="board-pop-hint">{t(`modes.${m}Hint`)}</span>
              </span>
            </label>
          ))}
        </div>
      ) : (
        <p className="board-pop-hint">{t(`modes.${state.mode}Hint`)}</p>
      )}

      {state.mode === 'restricted' && (
        <>
          {state.members.length > 0 ? (
            <ul className="board-access-list">
              {state.members.map((m) => (
                <li key={m.id}>
                  <span className="board-access-who">{m.name || m.email}</span>
                  {manage ? (
                    <>
                      <select
                        className="select"
                        value={m.role}
                        disabled={busy}
                        aria-label={t('roleFor', { name: m.name || m.email })}
                        onChange={(e) => void patch({ member: { userId: m.id, role: e.target.value } })}
                      >
                        <option value="edit">{t('roles.edit')}</option>
                        <option value="view">{t('roles.view')}</option>
                      </select>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        disabled={busy}
                        onClick={() => void patch({ member: { userId: m.id, role: null } })}
                      >
                        {t('remove')}
                      </button>
                    </>
                  ) : (
                    <span className="board-pop-hint">{t(`roles.${m.role}`)}</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="board-pop-hint">{t('noMembers')}</p>
          )}
          {manage && options.length > 0 && (
            <div className="board-share-row">
              <select className="select" value={pick} onChange={(e) => setPick(e.target.value)} aria-label={t('invite')}>
                <option value="">{t('choose')}</option>
                {options.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name || c.email}
                  </option>
                ))}
              </select>
              <select className="select" value={pickRole} onChange={(e) => setPickRole(e.target.value as BoardMemberRole)} aria-label={t('role')}>
                <option value="edit">{t('roles.edit')}</option>
                <option value="view">{t('roles.view')}</option>
              </select>
              <button
                type="button"
                className="btn btn-sm"
                disabled={!pick || busy}
                onClick={() => {
                  const userId = pick;
                  setPick('');
                  void patch({ member: { userId, role: pickRole } });
                }}
              >
                {t('invite')}
              </button>
            </div>
          )}
          {manage && options.length === 0 && (
            // Nadie más para sumar: o el workspace es solo de quien la creó, o ya están todos.
            <p className="board-pop-hint board-access-empty">
              {state.candidates.some((c) => c.id !== state.created_by) ? (
                t('allInvited')
              ) : (
                <>
                  {t('aloneHint')}{' '}
                  <Link href="/app/crm/settings?tab=team" className="board-access-link">
                    {t('inviteWorkspace')}
                  </Link>
                </>
              )}
            </p>
          )}
        </>
      )}

      {manage && (
        <>
          <p className="board-pop-title">{t('guestTitle')}</p>
          <p className="board-pop-hint">{t('guestHint')}</p>
          {state.guest_token ? (
            <>
              <div className="board-share-row">
                <input className="input data" readOnly value={guestUrl} aria-label={t('guestTitle')} onFocus={(e) => e.currentTarget.select()} />
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    void navigator.clipboard?.writeText(guestUrl).catch(() => {});
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                >
                  {copied ? t('copied') : t('copy')}
                </button>
              </div>
              <button type="button" className="btn btn-sm btn-ghost btn-danger board-share-off" aria-busy={busy} onClick={() => void patch({ guest: false })}>
                {t('guestDisable')}
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-sm board-share-on" aria-busy={busy} onClick={() => void patch({ guest: true })}>
              {t('guestEnable')}
            </button>
          )}
        </>
      )}
      {error && (
        <p className="ui-error" role="alert">
          {t('error')}
        </p>
      )}
    </div>
  );
}
