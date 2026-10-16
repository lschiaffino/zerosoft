import { getTranslations } from 'next-intl/server';
import { isWorkspaceAdmin, requireUser } from '@/lib/session';
import { dnsInstructions, listDomains } from '@/lib/link-domains';
import PageHeader from '@/components/ui/PageHeader';
import DomainsPanel from '@/components/link/DomainsPanel';

export const dynamic = 'force-dynamic';

/** Dominios propios de Link (antes en Ajustes globales, /app/settings#domains). */
export default async function LinkDomainsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'link' });
  const domains = (await listDomains(user.id)).map((d) => ({
    id: d.id,
    hostname: d.hostname,
    verified: d.verified,
    root_url: d.root_url,
    dns: dnsInstructions(d.hostname, d.verified === 1 ? null : d.verify_token),
  }));

  return (
    <div className="ui-page ui-page-narrow link-domains">
      <PageHeader title={t('domains.title')} description={t('domains.pageDesc')} />
      <DomainsPanel initial={domains} canManage={isWorkspaceAdmin(user)} />
    </div>
  );
}
