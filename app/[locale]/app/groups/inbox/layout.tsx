import { Suspense, type ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { listLabels, listNumbers, listPeople, listPropertyDefs } from '@/lib/groups';
import { listTeams } from '@/lib/groups-inbox';
import { listSavedLists } from '@/lib/groups-org';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import InboxShell from '@/components/groups/InboxShell';

export const dynamic = 'force-dynamic';

/** Bandeja en tres columnas: lista (este layout), chat y detalles (la página hija). */
export default async function GroupsInboxLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'groups' });
  const me = user.actingUser?.id ?? user.id;
  const [numbers, labels, people, teams, properties, lists] = await Promise.all([
    listNumbers(user.id),
    listLabels(user.id),
    listPeople(user.id),
    listTeams(user.id),
    listPropertyDefs(user.id),
    listSavedLists(user.id, me),
  ]);

  if (numbers.length === 0) {
    return (
      <div className="ui-page">
        <PageHeader title={t('inbox.title')} />
        <EmptyState
          title={t('inbox.noNumbersTitle')}
          body={t('inbox.noNumbersBody')}
          action={{ label: t('inbox.connect'), href: '/app/groups/settings?tab=numbers&new=1' }}
          product="groups"
        />
      </div>
    );
  }

  return (
    <Suspense fallback={null}>
      <InboxShell
        labels={labels.map((l) => ({ id: l.id, name: l.name, color: l.color }))}
        people={people}
        teams={teams.map((tm) => ({ id: tm.id, name: tm.name }))}
        properties={properties}
        me={me}
        initialLists={lists}
      >
        {props.children}
      </InboxShell>
    </Suspense>
  );
}
