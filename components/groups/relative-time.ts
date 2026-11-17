'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useMounted } from '@/components/ui/useMounted';
import { parseDbUtc } from '@/lib/utils';

/**
 * "hace 5 min" corto y en el idioma de la página. Aparte de ui.tsx para que
 * lo use también Inbox (el panel de HubSpot) sin cargar todos los textos de Lines.
 */
export function useRelativeTime() {
  const t = useTranslations('groups.time');
  const locale = useLocale();
  const mounted = useMounted();
  return (iso: string | null | undefined, now = Date.now()) => {
    if (!iso || !mounted) return '';
    const diff = Math.max(0, now - parseDbUtc(iso).getTime());
    const min = Math.floor(diff / 60_000);
    if (min < 1) return t('now');
    if (min < 60) return t('min', { n: min });
    const h = Math.floor(min / 60);
    if (h < 24) return t('hours', { n: h });
    const d = Math.floor(h / 24);
    if (d < 7) return t('days', { n: d });
    return parseDbUtc(iso).toLocaleDateString(locale);
  };
}
