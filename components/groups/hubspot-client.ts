'use client';

import { useCallback, useEffect, useState } from 'react';
import type { HubspotObjectKind, HubspotSchemaDto } from '@/lib/groups-hubspot-shared';
import { api } from './dialog-kit';

/**
 * El esquema de propiedades de HubSpot del workspace (de la empresa, del
 * contacto o del negocio), compartido entre la pantalla de un chat, el filtro
 * de la bandeja y los ajustes: se pide una vez por pestaña y objeto, y se
 * refresca cuando alguien lo cambia (fijar, actualizar).
 */
const cached: Record<HubspotObjectKind, HubspotSchemaDto | null> = { company: null, contact: null, deal: null };
const pending: Record<HubspotObjectKind, Promise<HubspotSchemaDto | null> | null> = { company: null, contact: null, deal: null };
const listeners: Record<HubspotObjectKind, Set<(s: HubspotSchemaDto | null) => void>> = { company: new Set(), contact: new Set(), deal: new Set() };

/** Guarda un esquema que devolvió el servidor (el objeto sale del esquema; sin él, la empresa). */
export function setHubspotSchema(schema: HubspotSchemaDto | null, kind: HubspotObjectKind = schema?.object ?? 'company'): void {
  cached[kind] = schema;
  pending[kind] = null;
  for (const fn of listeners[kind]) fn(schema);
}

export function loadHubspotSchema(force = false, kind: HubspotObjectKind = 'company'): Promise<HubspotSchemaDto | null> {
  if (!force && cached[kind]) return Promise.resolve(cached[kind]);
  if (!force && pending[kind]) return pending[kind] as Promise<HubspotSchemaDto | null>;
  const mine = api<HubspotSchemaDto>(`/api/groups/hubspot/properties${kind === 'company' ? '' : `?type=${kind}`}`).then((r) => {
    if (pending[kind] === mine) pending[kind] = null;
    if (r.data) setHubspotSchema(r.data, kind);
    return r.data;
  });
  pending[kind] = mine;
  return mine;
}

/** El esquema (null mientras carga o si no se pudo leer) y cómo volver a pedirlo. */
export function useHubspotSchema(enabled: boolean, kind: HubspotObjectKind = 'company'): { schema: HubspotSchemaDto | null; failed: boolean; reload: () => void } {
  const [schema, setSchema] = useState<HubspotSchemaDto | null>(cached[kind]);
  const [failed, setFailed] = useState(false);
  const reload = useCallback(() => {
    setFailed(false);
    void loadHubspotSchema(true, kind).then((s) => setFailed(s === null));
  }, [kind]);
  useEffect(() => {
    if (!enabled) return;
    const set = listeners[kind];
    set.add(setSchema);
    setSchema(cached[kind]);
    setFailed(false);
    if (!cached[kind]) void loadHubspotSchema(false, kind).then((s) => setFailed(s === null));
    return () => {
      set.delete(setSchema);
    };
  }, [enabled, kind]);
  return { schema, failed, reload };
}
