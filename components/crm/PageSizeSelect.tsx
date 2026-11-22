'use client';

import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { usePathname, useRouter } from '@/i18n/navigation';
import { PAGE_SIZES } from '@/lib/crm-page-size';

/** Filas por página del listado (25 / 50 / 100): cambia `per` en la URL y vuelve a la primera página. */
export default function PageSizeSelect({ value }: { value: number }) {
  const t = useTranslations('crm.listBar');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <select
      className="filter-select hs-page-size"
      value={value}
      aria-label={t('perPageLabel')}
      data-testid="page-size"
      onChange={(e) => {
        const q = new URLSearchParams(params.toString());
        q.delete('page');
        if (Number(e.target.value) === PAGE_SIZES[0]) q.delete('per');
        else q.set('per', e.target.value);
        const qs = q.toString();
        router.push(qs ? `${pathname}?${qs}` : pathname);
      }}
    >
      {PAGE_SIZES.map((n) => (
        <option key={n} value={n}>
          {t('perPage', { count: n })}
        </option>
      ))}
    </select>
  );
}
