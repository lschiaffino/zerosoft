/**
 * Track — qué se abre en el panel de la bandeja (al lado de la lista), como
 * la Inbox de Linear: el issue de un aviso y también el project o la
 * iniciativa de los avisos de updates, recordatorios y comentarios. Puro:
 * lo usan la bandeja, el panel y los tests.
 */

export type InboxPanelKind = 'issue' | 'project' | 'initiative';

export interface InboxPanelTarget {
  kind: InboxPanelKind;
  id: string;
  /** Pestaña del project que pedía el aviso (`?tab=updates`): en el panel va como `ptab`. */
  tab?: string | null;
  /** Ancla del aviso (#comments, #updates). */
  hash?: string;
}

const PLAN_RE = /^\/(?:[a-z]{2}\/)?app\/track\/projects\/([^/?#]+)/;
const INITIATIVE_RE = /^\/(?:[a-z]{2}\/)?app\/track\/initiatives\/([^/?#]+)/;

/** Lo que abre un aviso en el panel, o null si va a su página (o a ningún lado). */
export function inboxPanelTarget(n: { issue?: { id: string } | null; href?: string | null }): InboxPanelTarget | null {
  if (n.issue?.id) return { kind: 'issue', id: n.issue.id };
  const href = n.href ?? '';
  let url: URL;
  try {
    url = new URL(href, 'http://x');
  } catch {
    return null;
  }
  const plan = PLAN_RE.exec(url.pathname);
  const initiative = INITIATIVE_RE.exec(url.pathname);
  const id = decodeURIComponent((plan ?? initiative)?.[1] ?? '');
  // "new" es la página de alta, no un project.
  if (!id || id === 'new') return null;
  return {
    kind: plan ? 'project' : 'initiative',
    id,
    tab: plan ? url.searchParams.get('tab') : null,
    hash: url.hash || undefined,
  };
}

/** Ruta del panel para un destino, con los filtros de la bandeja (`params`) y el aviso (`n`). */
export function inboxPanelHref(target: InboxPanelTarget, params: URLSearchParams): string {
  const sp = new URLSearchParams(params);
  if (target.tab) sp.set('ptab', target.tab);
  const base =
    target.kind === 'issue'
      ? `/app/track/inbox/${encodeURIComponent(target.id)}`
      : `/app/track/inbox/${target.kind}/${encodeURIComponent(target.id)}`;
  return `${base}?${sp.toString()}${target.hash ?? ''}`;
}

/** ¿Hay algo abierto en el panel? (/app/track/inbox/<issue>, /project/<id>, /initiative/<id>). */
export function inboxPanelOpen(pathname: string | null): InboxPanelTarget | null {
  const m = /\/app\/track\/inbox\/([^/?#]+)(?:\/([^/?#]+))?/.exec(pathname ?? '');
  if (!m) return null;
  if ((m[1] === 'project' || m[1] === 'initiative') && m[2]) return { kind: m[1], id: decodeURIComponent(m[2]) };
  return { kind: 'issue', id: decodeURIComponent(m[1]) };
}

/** La bandeja con los filtros y la pestaña que tenía (sin el aviso abierto ni la pestaña del project). */
export function inboxListHref(search: string): string {
  const sp = new URLSearchParams(search);
  sp.delete('n');
  sp.delete('ptab');
  const qs = sp.toString();
  return `/app/track/inbox${qs ? `?${qs}` : ''}`;
}

/**
 * El project o la iniciativa de un aviso, si la persona los puede abrir hoy
 * (mismo alcance que sus páginas: workspace, y la planificación cerrada a los
 * invitados). Server only: lo usan las rutas del panel.
 */
export async function inboxEntityFor(
  kind: 'project' | 'initiative',
  id: string,
  user: { id: string; team?: { id: string } | null },
): Promise<{ id: string } | undefined> {
  const scope = { teamId: user.team?.id ?? null, ownerId: user.id };
  if (kind === 'project') {
    const { getAccessiblePlan } = await import('./track-plans');
    return getAccessiblePlan(id, scope);
  }
  const { getAccessibleInitiative } = await import('./track-initiatives');
  return getAccessibleInitiative(id, scope);
}
