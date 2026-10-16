'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import SettingsTabs from '@/components/ui/SettingsTabs';
import { RECORD_TABS } from './recordTab';

/**
 * Tabs del detalle de contacto, empresa y deal: Actividad / Propiedades /
 * Relacionados como `?tab=` (se puede linkear y sobrevive al refresh). La
 * página renderiza solo el panel activo, así cada tab pide lo suyo.
 */
export default function RecordTabs({ children }: { children: ReactNode }) {
  const t = useTranslations('crm.record');
  return (
    <SettingsTabs
      mode="query"
      param="tab"
      layout="top"
      label={t('tabsLabel')}
      className="record-tabs"
      items={RECORD_TABS.map((key) => ({ key, label: t(`tabs.${key}`) }))}
    >
      {children}
    </SettingsTabs>
  );
}
