import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import AppShell from '@/components/AppShell';
import '@/styles/link.css';
import '@/styles/crm.css';

export const dynamic = 'force-dynamic';

export default async function AppLayout({
  children,
  params: { locale },
}: {
  children: ReactNode;
  params: { locale: string };
}) {
  await requireUser(locale);
  const tLink = await getTranslations({ locale, namespace: 'link' });
  const tCrm = await getTranslations({ locale, namespace: 'crm' });

  return (
    <main className="app-shell container">
      <AppShell
        labels={{
          switcherLink: tCrm('switcher.link'),
          switcherCrm: tCrm('switcher.crm'),
          link: {
            overview: tLink('tabs.overview'),
            links: tLink('tabs.links'),
            new: tLink('tabs.new'),
            settings: tLink('tabs.settings'),
          },
          crm: {
            overview: tCrm('tabs.overview'),
            contacts: tCrm('tabs.contacts'),
            companies: tCrm('tabs.companies'),
            deals: tCrm('tabs.deals'),
            tasks: tCrm('tabs.tasks'),
            lists: tCrm('tabs.lists'),
            reports: tCrm('tabs.reports'),
            settings: tCrm('tabs.settings'),
          },
        }}
      />
      {children}
    </main>
  );
}
