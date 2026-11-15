'use client';

import { useCallback, useEffect, useState } from 'react';
import type { TrackSavedView } from '@/lib/track-ux';
import type { viewPayload } from '@/lib/track-issue-list';
import { pushNotice } from './trackUndo';

/**
 * De dónde salen las vistas guardadas de una lista: las de un team
 * (track_issue_views, se comparten y van a favoritas) o las de cualquier otra
 * lista (track_list_views: personales o compartidas con el workspace).
 */
export type ListViewsSource = { kind: 'team'; projectId: string } | { kind: 'personal'; key: string };

type Payload = ReturnType<typeof viewPayload>;

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`api ${res.status}`);
  return (await res.json()) as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/** El sidebar muestra las favoritas: se entera sin recargar. */
const announce = () => window.dispatchEvent(new Event('zs:track-views-changed'));

export interface ListViews {
  views: TrackSavedView[];
  /** Ya se sabe qué vistas hay (las de un team vienen del server). */
  ready: boolean;
  /** Se pueden compartir: las de un team con el team, las de otras listas con el workspace (My issues no). */
  shareable: boolean;
  create: (name: string, shared: boolean, payload: Payload) => Promise<TrackSavedView>;
  update: (id: string, payload: Payload) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setDefault: (id: string) => Promise<void>;
  setShared: (id: string, shared: boolean) => Promise<void>;
  setFavorite: (id: string, favorite: boolean) => Promise<void>;
}

export function useListViews(source: ListViewsSource | null, userId: string, initial?: TrackSavedView[], messages?: { saved: string; sharedOn: string; sharedOff: string }): ListViews {
  const [views, setViews] = useState<TrackSavedView[]>(initial ?? []);
  const [ready, setReady] = useState(Boolean(initial) || !source);
  const [listShareable, setListShareable] = useState(false);
  const key = source ? (source.kind === 'team' ? `team:${source.projectId}` : `personal:${source.key}`) : '';

  useEffect(() => {
    if (!source || initial) return;
    let alive = true;
    const url = source.kind === 'team' ? `/api/track/projects/${source.projectId}/views` : `/api/track/list-views?key=${encodeURIComponent(source.key)}`;
    void api<{ rows: TrackSavedView[]; shareable?: boolean }>(url)
      .then((d) => {
        if (!alive) return;
        setViews(d.rows);
        setListShareable(Boolean(d.shareable));
      })
      .catch(() => undefined)
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const replace = (v: TrackSavedView) => setViews((prev) => prev.map((x) => (x.id === v.id ? v : x)));
  const team = source?.kind === 'team';

  const create = useCallback(
    async (name: string, shared: boolean, payload: Payload) => {
      if (!source) throw new Error('no source');
      const created =
        source.kind === 'team'
          ? await api<TrackSavedView>(`/api/track/projects/${source.projectId}/views`, json('POST', { name, shared, ...payload }))
          : await api<TrackSavedView>('/api/track/list-views', json('POST', { key: source.key, name, shared, ...payload }));
      setViews((prev) => [...prev, created]);
      return created;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );

  const update = async (id: string, payload: Payload) => {
    replace(team ? await api<TrackSavedView>(`/api/track/views/${id}`, json('PATCH', payload)) : await api<TrackSavedView>('/api/track/list-views', json('PATCH', { id, ...payload })));
    if (messages) pushNotice(messages.saved);
  };
  const rename = async (id: string, name: string) => {
    replace(team ? await api<TrackSavedView>(`/api/track/views/${id}`, json('PATCH', { name })) : await api<TrackSavedView>('/api/track/list-views', json('PATCH', { id, name })));
    if (team) announce();
  };
  const remove = async (id: string) => {
    if (team) await api(`/api/track/views/${id}`, { method: 'DELETE' });
    else await api(`/api/track/list-views?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    setViews((prev) => prev.filter((v) => v.id !== id));
    if (team) announce();
  };
  const setDefault = async (id: string) => {
    await api<TrackSavedView>(`/api/track/views/${id}/default`, { method: 'POST' });
    setViews((prev) => prev.map((v) => ({ ...v, is_default: v.user_id === userId && v.id === id })));
  };
  const setShared = async (id: string, shared: boolean) => {
    replace(
      team
        ? await api<TrackSavedView>(`/api/track/views/${id}`, json('PATCH', { shared }))
        : await api<TrackSavedView>('/api/track/list-views', json('PATCH', { id, shared })),
    );
    if (messages) pushNotice(shared ? messages.sharedOn : messages.sharedOff);
  };
  const setFavorite = async (id: string, favorite: boolean) => {
    replace(await api<TrackSavedView>(`/api/track/views/${id}/favorite`, json('POST', { favorite })));
    announce();
  };

  return { views, ready, shareable: team || listShareable, create, update, rename, remove, setDefault, setShared, setFavorite };
}
