'use client';

import { useEffect, useState } from 'react';
import { WORKSPACE_HEADER } from '@/lib/return-path';

/** Sin workspace: entrar, cambiar de workspace y marcar avisos valen desde cualquier pestaña. */
const EXEMPT = ['/api/auth', '/api/teams/switch', '/api/teams/accept', '/api/teams/join', '/api/teams/guest-of', '/api/onboarding', '/api/notifications'];

function guarded(input: RequestInfo | URL, init?: RequestInit): 'api' | 'action' | null {
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (method === 'GET' || method === 'HEAD') return null;
  const raw = input instanceof Request ? input.url : String(input);
  const url = new URL(raw, window.location.href);
  if (url.origin !== window.location.origin) return null;
  // Server actions: se postean a la página con este header.
  if (new Headers(init?.headers).has('next-action')) return 'action';
  return url.pathname.startsWith('/api/') && !EXEMPT.some((p) => url.pathname.startsWith(p)) ? 'api' : null;
}

type Lost = { teamId: string | null } | 'gone';

/**
 * Cada escritura de la pestaña dice para qué workspace es (lib/session.ts la
 * rechaza si ya no es el activo). Si la rechazaron por eso, avisa arriba del
 * contenido, sin taparlo ni recargar: lo escrito sigue ahí. Volver al
 * workspace deja reintentar; si ya no se puede, lo dice.
 */
export default function WorkspaceGuard({
  workspaceId,
  workspaceName,
  labels,
}: {
  workspaceId: string;
  workspaceName: string;
  labels: { title: string; switched: string; gone: string; switchBack: string; reload: string; home: string; switchError: string };
}) {
  const [lost, setLost] = useState<Lost | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const original = window.fetch;
    const wrapped: typeof window.fetch = async (input, init) => {
      if (!guarded(input, init)) return original(input, init);
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      headers.set(WORKSPACE_HEADER, workspaceId);
      const res = await original(input, { ...init, headers });
      // Rechazada: 401 en la API; en una server action, un 500 (tira 'unauthorized') o un redirect.
      if (!res.ok || res.redirected || res.headers.has('x-action-redirect')) {
        const now = await original(`/api/teams/switch?id=${encodeURIComponent(workspaceId)}`).catch(() => null);
        const data = now?.ok ? ((await now.json().catch(() => null)) as { active?: boolean; member?: boolean; teamId?: string | null } | null) : null;
        if (data && !data.active) setLost(data.member ? { teamId: data.teamId ?? null } : 'gone');
      }
      return res;
    };
    window.fetch = wrapped;
    return () => {
      if (window.fetch === wrapped) window.fetch = original;
    };
  }, [workspaceId]);

  async function switchBack() {
    if (lost === null || lost === 'gone') return;
    setBusy(true);
    setError(false);
    const res = await fetch('/api/teams/switch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ teamId: lost.teamId }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) setLost(null);
    else setError(true);
  }

  if (!lost) return null;
  const home = `/${window.location.pathname.split('/')[1] || 'en'}/app`;
  return (
    <div className="ws-guard" role="alert" data-testid="workspace-guard">
      <p className="ws-guard-title">{labels.title}</p>
      <p className="ws-guard-body">{lost === 'gone' ? labels.gone : labels.switched}</p>
      {error && <p className="ui-error">{labels.switchError}</p>}
      <div className="ws-guard-actions">
        {lost === 'gone' ? (
          <a className="btn btn-primary btn-sm" href={home}>
            {labels.home}
          </a>
        ) : (
          <>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void switchBack()} disabled={busy} aria-busy={busy || undefined}>
              {labels.switchBack.replace('{workspace}', workspaceName)}
            </button>
            <a className="btn btn-secondary btn-sm" href={home}>
              {labels.reload}
            </a>
          </>
        )}
      </div>
    </div>
  );
}
