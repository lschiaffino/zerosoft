'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { NETWORK_SPECS, type SocialNetwork } from '@/lib/social-networks';

/**
 * Filtros de la lista de publicaciones por red y por cuenta. Cambiar uno
 * navega con el nuevo query (la lista se arma en el servidor); el estado y la
 * búsqueda se mantienen.
 */
export default function PostsFilters({
  accounts,
  networks,
  account,
  network,
  status,
  q,
}: {
  accounts: Array<{ id: string; name: string; network: SocialNetwork }>;
  networks: SocialNetwork[];
  account: string;
  network: string;
  status: string;
  q: string;
}) {
  const t = useTranslations('social.posts');
  const router = useRouter();

  function go(next: { account?: string; network?: string }) {
    const sp = new URLSearchParams();
    if (status !== 'all') sp.set('status', status);
    if (q) sp.set('q', q);
    const a = next.account ?? account;
    const n = next.network ?? network;
    if (n) sp.set('network', n);
    if (a) sp.set('account', a);
    const qs = sp.toString();
    router.push(`/app/social/posts${qs ? `?${qs}` : ''}`);
  }

  // Con una red elegida, solo sus cuentas.
  const shown = network ? accounts.filter((a) => a.network === network) : accounts;
  if (networks.length < 2 && accounts.length < 2) return null;

  return (
    <div className="sc-row sc-filters">
      {networks.length > 1 && (
        <select
          className="select"
          aria-label={t('filterNetwork')}
          data-testid="posts-filter-network"
          value={network}
          onChange={(e) => {
            const v = e.target.value;
            const keep = !v || accounts.find((a) => a.id === account)?.network === v;
            go({ network: v, account: keep ? account : '' });
          }}
        >
          <option value="">{t('allNetworks')}</option>
          {networks.map((n) => (
            <option key={n} value={n}>
              {NETWORK_SPECS[n].name}
            </option>
          ))}
        </select>
      )}
      {accounts.length > 1 && (
        <select className="select" aria-label={t('filterAccount')} data-testid="posts-filter-account" value={account} onChange={(e) => go({ account: e.target.value })}>
          <option value="">{t('allAccounts')}</option>
          {shown.map((a) => (
            <option key={a.id} value={a.id}>
              {network ? a.name : `${a.name} · ${NETWORK_SPECS[a.network].name}`}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
