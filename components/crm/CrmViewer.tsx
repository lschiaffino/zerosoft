'use client';

import { createContext, useContext, type ReactNode } from 'react';

/** Quién mira el CRM: hoy solo si es admin (para mostrar pistas de configuración). */
const CrmViewerContext = createContext<{ isAdmin: boolean }>({ isAdmin: false });

export function CrmViewerProvider({ isAdmin, children }: { isAdmin: boolean; children: ReactNode }) {
  return <CrmViewerContext.Provider value={{ isAdmin }}>{children}</CrmViewerContext.Provider>;
}

export function useCrmAdmin(): boolean {
  return useContext(CrmViewerContext).isAdmin;
}
