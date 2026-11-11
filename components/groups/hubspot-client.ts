'use client';

import { useCallback, useEffect, useState } from 'react';
import type { HubspotSchemaDto } from '@/lib/groups-hubspot-shared';
import { api } from './ui';

/**
 * El esquema de propiedades de HubSpot del workspace, compartido entre la
 * pantalla de un chat, el filtro de la bandeja y los ajustes: se pide una vez
 * por pestaña y se refresca cuando alguien lo cambia (fijar, actualizar).
 */
let cached: HubspotSchemaDto | null = null;
let pending: Promise<HubspotSchemaDto | null> | null = null;
const listeners = new Set<(s: HubspotSchemaDto | null) => void>();

export function setHubspotSchema(schema: HubspotSchemaDto | null): void {
  cached = schema;
  pending = null;
  for (const fn of listeners) fn(schema);
}

export function loadHubspotSchema(force = false): Promise<HubspotSchemaDto | null> {
  if (!force && cached) return Promise.resolve(cached);
  if (!force && pending) return pending;
  const mine = api<HubspotSchemaDto>('/api/groups/hubspot/properties').then((r) => {
    if (pending === mine) pending = null;
    if (r.data) setHubspotSchema(r.data);
    return r.data;
  });
  pending = mine;
  return mine;
}

/** El esquema (null mientras carga o si no se pudo leer) y cómo volver a pedirlo. */
export function useHubspotSchema(enabled: boolean): { schema: HubspotSchemaDto | null; failed: boolean; reload: () => void } {
  const [schema, setSchema] = useState<HubspotSchemaDto | null>(cached);
  const [failed, setFailed] = useState(false);
  const reload = useCallback(() => {
    setFailed(false);
    void loadHubspotSchema(true).then((s) => setFailed(s === null));
  }, []);
  useEffect(() => {
    if (!enabled) return;
    listeners.add(setSchema);
    setSchema(cached);
    if (!cached) void loadHubspotSchema().then((s) => setFailed(s === null));
    return () => {
      listeners.delete(setSchema);
    };
  }, [enabled]);
  return { schema, failed, reload };
}
