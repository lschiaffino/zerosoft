import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { DEMO_MODE, requireUser } from '@/lib/session';
import { countDueTasks } from '@/lib/crm';
import AppSidebar from '@/components/app/AppSidebar';
import CommandSearch from '@/components/app/CommandSearch';
import '@/styles/link.css';
import '@/styles/crm.css';
import '@/styles/docs.css';
import '@/styles/app.css';

export const dynamic = 'force-dynamic';

export default async function AppLayout({
  children,
  params: { locale },
}: {
  children: ReactNode;
  params: { locale: string };
}) {
  const user = await requireUser(locale);
  const tSide = await getTranslations({ locale, namespace: 'common.sidebar' });
  const tLink = await getTranslations({ locale, namespace: 'link' });
  const tCrm = await getTranslations({ locale, namespace: 'crm' });
  const tDocs = await getTranslations({ locale, namespace: 'docs' });
  const tasksDue = await countDueTasks(user.id);

  return (
    <div className="app-frame">
      <AppSidebar
        demo={DEMO_MODE}
        tasksDue={tasksDue}
        user={{
          name: user.actingUser?.name ?? user.name,
          email: user.actingUser?.email ?? user.email,
          image: user.actingUser?.image ?? user.image,
        }}
        teamName={user.actingUser && user.team ? user.team.name : null}
        labels={{
          search: tSide('search'),
          new: tSide('new'),
          backToSite: tSide('backToSite'),
          docsSite: tSide('docs'),
          soon: tSide('soon'),
          signOut: tSide('signOut'),
          records: tSide('records'),
          activity: tSide('activity'),
          insights: tSide('insights'),
          linksSection: tSide('linksSection'),
          workspace: tSide('workspace'),
          newContact: tSide('newContact'),
          newCompany: tSide('newCompany'),
          newDeal: tSide('newDeal'),
          newTask: tSide('newTask'),
          newLink: tSide('newLink'),
          newDocPage: tSide('newDocPage'),
          team: tSide('team'),
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
          docs: {
            overview: tDocs('sidebar.overview'),
            pages: tDocs('sidebar.pages'),
            new: tDocs('sidebar.new'),
          },
        }}
      />
      <main className="app-content">{children}</main>
      <CommandSearch />
    </div>
  );
}
