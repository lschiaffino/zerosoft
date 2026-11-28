'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { defaultOptionSets, optionHelpers, type OptionHelpers, type OptionSets } from '@/lib/crm-property-options-shared';

interface CrmViewerValue {
  isAdmin: boolean;
  personId: string;
  /** Opciones de Lifecycle stage, Lead status y Deal type del workspace (Ajustes › Datos). */
  options: OptionSets;
}

const FACTORY = defaultOptionSets();

/** Quién mira el CRM: si es admin (pistas de configuración) y su persona (dueña de lo que registra). */
const CrmViewerContext = createContext<CrmViewerValue>({ isAdmin: false, personId: '', options: FACTORY });

export function CrmViewerProvider({
  isAdmin,
  personId = '',
  options = FACTORY,
  children,
}: {
  isAdmin: boolean;
  personId?: string;
  options?: OptionSets;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ isAdmin, personId, options }), [isAdmin, personId, options]);
  return <CrmViewerContext.Provider value={value}>{children}</CrmViewerContext.Provider>;
}

export function useCrmAdmin(): boolean {
  return useContext(CrmViewerContext).isAdmin;
}

/** La persona que mira ('' fuera del CRM). */
export function useCrmPersonId(): string {
  return useContext(CrmViewerContext).personId;
}

/**
 * Nombres y opciones de Lifecycle stage, Lead status y Deal type del workspace: las
 * renombradas con su nombre, las archivadas fuera de los selectores (salvo el
 * valor actual) y marcadas en los filtros. Fuera del CRM, las de fábrica.
 */
export function useCrmOptions(): OptionHelpers {
  const t = useTranslations('crm');
  const sets = useContext(CrmViewerContext).options;
  return useMemo(
    () =>
      optionHelpers(
        sets,
        (prop, v) => (t.has(`enums.${prop}.${v}`) ? t(`enums.${prop}.${v}`) : v),
        (label) => t('propertyOptions.archivedName', { name: label }),
      ),
    [sets, t],
  );
}
