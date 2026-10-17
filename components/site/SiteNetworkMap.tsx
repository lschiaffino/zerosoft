import { useLocale, useTranslations } from 'next-intl';
import NetworkMap, { type NetworkMapLabels } from '@/components/brand/NetworkMap';
import { NET_STATIONS } from '@/lib/brand-network';
import { PRODUCT_KEYS, type ProductKey } from '@/lib/products';
import '@/styles/network.css';

/**
 * El plano de la suite en el sitio: cada línea y cada estación llevan a la
 * página de su producto. Los textos son los de la guía de marca (brand.map).
 */
export default function SiteNetworkMap({ focus, className }: { focus?: ProductKey; className?: string }) {
  const locale = useLocale();
  const t = useTranslations('brand.map');
  const labels: NetworkMapLabels = {
    title: t('title'),
    hint: t('hint'),
    hintTouch: t('hintTouch'),
    lines: Object.fromEntries(PRODUCT_KEYS.map((k) => [k, t(`lines.${k}`)])) as Record<ProductKey, string>,
    stations: Object.fromEntries(
      NET_STATIONS.map((s) => [s.id, { name: t(`stations.${s.id}.name`), desc: t(`stations.${s.id}.desc`) }]),
    ),
  };
  return <NetworkMap locale={locale} labels={labels} focus={focus} className={className} />;
}
