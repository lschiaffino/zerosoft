import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { isWorkspaceAdmin, realUserId, requireUser } from '@/lib/session';
import { ProductSettingsShell } from '@/components/app/ProductSettingsShell';
import FormSection from '@/components/ui/FormSection';
import { PRODUCT_SETTINGS_SHORTCUTS } from '@/lib/product-settings';
import { getDocsSettings, listTeamspaces } from '@/lib/docs-access';
import { listPageMentionables } from '@/lib/docs';
import { DocsAccessSettings, DocsAuditLog, DocsTeamspacesSettings } from '@/components/docs/DocsAdminSettings';
import { DocsSiteSettings, DocsWorkspaceExport } from '@/components/docs/DocsSiteSettings';
import { docsAllowed } from '@/lib/docs-guard';
import { verifiedSiteHost } from '@/lib/docs-site';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'settings.products' });
  return { title: t('title', { app: 'Docs' }) };
}

/**
 * Ajustes de Docs: acceso de los miembros y seguridad (exportar, publicar,
 * invitados), teamspaces y el registro de auditoría (admins).
 */
export default async function DocsSettingsPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { locale } = await props.params;
  const { tab: rawTab } = await props.searchParams;
  const user = await requireUser(locale);
  const admin = isWorkspaceAdmin(user);
  const t = await getTranslations({ locale, namespace: 'docs.admin' });
  const ts = await getTranslations({ locale, namespace: 'settings.products' });
  const tabs = [
    { key: 'general', label: ts('general') },
    { key: 'teamspaces', label: t('teamspacesTab') },
    ...(admin ? [{ key: 'site', label: t('siteTab') }] : []),
    ...(admin ? [{ key: 'audit', label: t('auditTab') }] : []),
  ];
  const tab = tabs.some((x) => x.key === rawTab) ? rawTab : 'general';
  const [settings, teamspaces, people] = await Promise.all([
    getDocsSettings(user.id),
    listTeamspaces(user.id, realUserId(user)),
    listPageMentionables({ user_id: user.id }),
  ]);
  const shortcuts = PRODUCT_SETTINGS_SHORTCUTS.docs;
  const siteHost = tab === 'site' ? await verifiedSiteHost(user.id) : null;
  const canExport = await docsAllowed(user, user.id, 'allow_export');

  return (
    <ProductSettingsShell locale={locale} product="docs" tabs={tabs}>
      <div className="st-stack">
        {tab === 'general' && (
          <>
            <DocsAccessSettings initial={settings} canManage={admin} />
            <DocsWorkspaceExport allowed={canExport} />
            <FormSection title={ts('shortcuts')}>
              <ul className="st-links">
                {shortcuts.map((s) => (
                  <li key={s.href}>
                    <Link href={s.href} className="st-link">
                      {ts(`links.${s.label}`)}
                    </Link>
                  </li>
                ))}
              </ul>
            </FormSection>
          </>
        )}
        {tab === 'teamspaces' && (
          <DocsTeamspacesSettings
            initial={teamspaces}
            people={people.map((p) => ({ id: p.id, name: p.name?.trim() || p.email, email: p.email }))}
            meId={realUserId(user)}
            isAdmin={admin}
            canCreate={admin || settings.member_role === 'edit' || settings.member_role === 'full'}
          />
        )}
        {tab === 'site' && admin && (
          <DocsSiteSettings
            handle={user.handle ?? null}
            publicBase={user.handle ? (siteHost ? `https://${siteHost}` : `${(process.env.NEXTAUTH_URL ?? '').replace(/\/$/, '')}/${locale}/h/${user.handle}`) : null}
          />
        )}
        {tab === 'audit' && admin && (
          <DocsAuditLog people={people.map((p) => ({ id: p.id, name: p.name?.trim() || p.email }))} />
        )}
      </div>
    </ProductSettingsShell>
  );
}
