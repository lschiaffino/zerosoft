'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from '@/i18n/navigation';
import { LEGACY_ANCHORS } from '@/lib/crm-settings-tabs';

/**
 * Ajustes era una sola página con anclas (#quotas, #pipelines…). Un link
 * viejo con ancla y sin ?tab= se lleva a la pestaña que hoy tiene esa sección.
 */
export default function LegacySettingsAnchor() {
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    const tab = LEGACY_ANCHORS[hash];
    if (tab && !new URLSearchParams(window.location.search).has('tab')) {
      router.replace(`${pathname}?tab=${tab}`, { scroll: false });
    }
  }, [router, pathname]);
  return null;
}
