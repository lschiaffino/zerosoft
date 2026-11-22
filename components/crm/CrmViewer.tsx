'use client';

import { createContext, useContext, type ReactNode } from 'react';

/** Quién mira el CRM: si es admin (pistas de configuración) y su persona (dueña de lo que registra). */
const CrmViewerContext = createContext<{ isAdmin: boolean; personId: string }>({ isAdmin: false, personId: '' });

export function CrmViewerProvider({ isAdmin, personId = '', children }: { isAdmin: boolean; personId?: string; children: ReactNode }) {
  return <CrmViewerContext.Provider value={{ isAdmin, personId }}>{children}</CrmViewerContext.Provider>;
}

export function useCrmAdmin(): boolean {
  return useContext(CrmViewerContext).isAdmin;
}

/** La persona que mira ('' fuera del CRM). */
export function useCrmPersonId(): string {
  return useContext(CrmViewerContext).personId;
}
