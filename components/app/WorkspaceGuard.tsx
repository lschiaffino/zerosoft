'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { WORKSPACE_HEADER } from '@/lib/return-path';

/** Sin workspace: entrar, cambiar de workspace y marcar avisos valen desde cualquier pestaña. */
const STORAGE = 'zs-workspace-guard';
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
export interface GuardLabels {
  title: string;
  switched: string;
  gone: string;
  switchBack: string;
  reload: string;
  home: string;
  switchError: string;
}
interface Saved {
  id: string;
  name: string;
  lost: Lost;
  labels: GuardLabels;
}

function readSaved(): Saved | null {
  try {
    const raw = sessionStorage.getItem(STORAGE);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

function clearSaved() {
  try {
    sessionStorage.removeItem(STORAGE);
  } catch {
    /* nada */
  }
}

/** El aviso: qué pasó y cómo seguir. `stay`: la página sigue siendo la del workspace (lo escrito sigue ahí). */
function Notice({ saved, stay, fixed, onDone }: { saved: Saved; stay: boolean; fixed?: boolean; onDone: () => void }) {
  const { labels, lost, name } = saved;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const home = `/${window.location.pathname.split('/')[1] || 'en'}/app`;

  async function switchBack() {
    if (lost === 'gone') return;
    setBusy(true);
    setError(false);
    const res = await fetch('/api/teams/switch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ teamId: lost.teamId }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(true);
      return;
    }
    clearSaved();
    // Si la página ya se recargó en el otro workspace, hay que volver a pintarla (o salir del 404).
    if (stay) onDone();
    else window.location.reload();
  }

  return (
    <div className={`ws-guard${fixed ? ' ws-guard-fixed' : ''}`} role="alert" data-testid="workspace-guard">
      <p className="ws-guard-title">{labels.title}</p>
      <p className="ws-guard-body">{(lost === 'gone' ? labels.gone : labels.switched).replace('{workspace}', name)}</p>
      {error && <p className="ui-error">{labels.switchError}</p>}
      <div className="ws-guard-actions">
        {lost === 'gone' ? (
          <a className="btn btn-primary btn-sm" href={home} onClick={clearSaved}>
            {labels.home}
          </a>
        ) : (
          <>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void switchBack()} disabled={busy} aria-busy={busy || undefined}>
              {labels.switchBack.replace('{workspace}', name)}
            </button>
            <a className="btn btn-secondary btn-sm" href={home} onClick={clearSaved}>
              {labels.reload}
            </a>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Cada escritura de la pestaña dice para qué workspace es (lib/session.ts la
 * rechaza si ya no es el activo). Si la rechazaron por eso, avisa arriba del
 * contenido, sin taparlo. El aviso queda guardado en la pestaña: una server
 * action rechazada termina recargando la página, ya en el otro workspace.
 */
export default function WorkspaceGuard({ workspaceId, workspaceName, labels }: { workspaceId: string; workspaceName: string; labels: GuardLabels }) {
  const [saved, setSaved] = useState<Saved | null>(null);

  useEffect(() => {
    const prior = readSaved();
    if (!prior) return;
    if (prior.id === workspaceId) clearSaved();
    else setSaved(prior);
  }, [workspaceId]);

  useEffect(() => {
    const original = window.fetch;
    const wrapped: typeof window.fetch = async (input, init) => {
      const kind = guarded(input, init);
      if (!kind) return original(input, init);
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      headers.set(WORKSPACE_HEADER, workspaceId);
      const res = await original(input, { ...init, headers });
      // Rechazada: 401 en la API. Una server action puede responder 500, un redirect o hasta un 200 con
      // su propio error, así que después de cada una se pregunta. Son pocas por pantalla.
      if (kind === 'action' || !res.ok || res.redirected) {
        const now = await original(`/api/teams/switch?id=${encodeURIComponent(workspaceId)}`).catch(() => null);
        const data = now?.ok ? ((await now.json().catch(() => null)) as { active?: boolean; member?: boolean; teamId?: string | null } | null) : null;
        if (data && !data.active) {
          const next: Saved = { id: workspaceId, name: workspaceName, lost: data.member ? { teamId: data.teamId ?? null } : 'gone', labels };
          setSaved(next);
          try {
            sessionStorage.setItem(STORAGE, JSON.stringify(next));
          } catch {
            /* sin almacenamiento: el aviso vive hasta recargar */
          }
        }
      }
      return res;
    };
    window.fetch = wrapped;
    return () => {
      if (window.fetch === wrapped) window.fetch = original;
    };
  }, [workspaceId, workspaceName, labels]);

  return (
    <>
      <span data-workspace-guard hidden />
      {saved && <Notice saved={saved} stay={saved.id === workspaceId} onDone={() => setSaved(null)} />}
    </>
  );
}

/**
 * El mismo aviso donde no hay shell de la app: la recarga de una escritura
 * rechazada puede caer en un 404 (la página era del otro workspace). Vive en el
 * layout raíz y solo aparece si quedó un aviso guardado en esta pestaña.
 */
export function WorkspaceNoticeOutsideApp() {
  const [saved, setSaved] = useState<Saved | null>(null);
  // Sigue a la navegación: la vuelta de la escritura rechazada es suave y este layout no se vuelve a montar.
  const pathname = usePathname();
  useEffect(() => {
    setSaved(document.querySelector('[data-workspace-guard]') ? null : readSaved());
  }, [pathname]);
  if (!saved) return null;
  return <Notice saved={saved} stay={false} fixed onDone={() => setSaved(null)} />;
}
