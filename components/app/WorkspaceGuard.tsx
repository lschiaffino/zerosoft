'use client';

import { useEffect, useState } from 'react';
import { WORKSPACE_HEADER } from '@/lib/return-path';

/** Sin workspace: entrar, cambiar de workspace y marcar avisos valen desde cualquier pestaña. */
const EXEMPT = ['/api/auth', '/api/teams/switch', '/api/teams/accept', '/api/teams/join', '/api/teams/guest-of', '/api/onboarding', '/api/notifications'];

function guarded(input: RequestInfo | URL, init?: RequestInit): boolean {
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (method === 'GET' || method === 'HEAD') return false;
  const raw = input instanceof Request ? input.url : String(input);
  const url = new URL(raw, window.location.href);
  if (url.origin !== window.location.origin) return false;
  // Server actions: se postean a la página con este header.
  if (new Headers(init?.headers).has('next-action')) return true;
  return url.pathname.startsWith('/api/') && !EXEMPT.some((p) => url.pathname.startsWith(p));
}

/**
 * Cada escritura de la pestaña dice para qué workspace es (lib/session.ts la
 * rechaza si ya no es el activo). Si la rechazaron por eso, avisa y ofrece
 * recargar: nada se guardó en otro lado.
 */
export default function WorkspaceGuard({ workspaceId, labels }: { workspaceId: string; labels: { title: string; body: string; reload: string } }) {
  const [lost, setLost] = useState(false);

  useEffect(() => {
    const original = window.fetch;
    const wrapped: typeof window.fetch = async (input, init) => {
      if (!guarded(input, init)) return original(input, init);
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      headers.set(WORKSPACE_HEADER, workspaceId);
      const res = await original(input, { ...init, headers });
      if (res.status === 401 || res.redirected) {
        const now = await original('/api/teams/workspace').catch(() => null);
        const data = now?.ok ? ((await now.json().catch(() => null)) as { id?: string } | null) : null;
        if (data?.id && data.id !== workspaceId) setLost(true);
      }
      return res;
    };
    window.fetch = wrapped;
    return () => {
      if (window.fetch === wrapped) window.fetch = original;
    };
  }, [workspaceId]);

  if (!lost) return null;
  return (
    <div className="ws-guard" role="alert" data-testid="workspace-guard">
      <p className="ws-guard-title">{labels.title}</p>
      <p className="ws-guard-body">{labels.body}</p>
      <button type="button" className="btn btn-primary btn-sm" onClick={() => window.location.reload()}>
        {labels.reload}
      </button>
    </div>
  );
}
