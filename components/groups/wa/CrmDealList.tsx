'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { ChatCrmDeal } from '@/lib/groups-crm-deals';

/**
 * Los negocios del CRM de un chat (pestaña CRM del panel, Lines e Inbox): abiertos primero, con etapa y monto; un
 * toque abre el negocio. Vacía, lo dice. Solo usa `groups.wa.details` (Inbox no recibe el resto de `groups`).
 */
export default function CrmDealList({ deals }: { deals: ChatCrmDeal[] }) {
  const t = useTranslations('groups.wa.details');
  const locale = useLocale();
  const money = (d: ChatCrmDeal) => {
    try {
      return new Intl.NumberFormat(locale, { style: 'currency', currency: d.currency, maximumFractionDigits: 0 }).format(d.amount);
    } catch {
      return String(d.amount);
    }
  };
  if (deals.length === 0) return <p className="ui-help">{t('noDeals')}</p>;
  return (
    <ul className="gr-mini-list gr-deal-list">
      {deals.map((d) => (
        <li key={d.id} data-state={d.state}>
          <Link href={`/app/crm/deals/${d.id}`}>{d.name || t('untitledDeal')}</Link>
          <span className="ui-help">{[d.stage, d.amount ? money(d) : ''].filter(Boolean).join(' · ')}</span>
        </li>
      ))}
    </ul>
  );
}
