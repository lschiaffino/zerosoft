'use client';

import { useEffect, useState } from 'react';
import type { DocsMentionableUser } from '@/lib/docs-types';

/** Una pedida por URL mientras dure la pestaña (varias bases en la misma página comparten). */
const cache = new Map<string, Promise<DocsMentionableUser[]>>();

/**
 * Miembros del workspace para las propiedades persona. Docs pide los de la
 * página (`?page=`, el workspace dueño); Notes los del workspace activo.
 */
export function useDbMembers(url: string | null): DocsMentionableUser[] {
  const [members, setMembers] = useState<DocsMentionableUser[]>([]);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    let p = cache.get(url);
    if (!p) {
      p = fetch(url)
        .then((r) => (r.ok ? r.json() : { rows: [] }))
        .then((d: { rows?: DocsMentionableUser[] }) => d.rows ?? [])
        .catch(() => {
          cache.delete(url);
          return [];
        });
      cache.set(url, p);
    }
    void p.then((rows) => alive && setMembers(rows));
    return () => {
      alive = false;
    };
  }, [url]);
  return members;
}

export function memberName(m: Pick<DocsMentionableUser, 'name' | 'email'>): string {
  return m.name?.trim() || m.email;
}

/** id → nombre (formatValue, agrupar por persona). */
export function peopleMap(members: DocsMentionableUser[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of members) out[m.id] = memberName(m);
  return out;
}
