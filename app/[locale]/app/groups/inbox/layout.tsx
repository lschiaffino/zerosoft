import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { listLabels, listNumbers, listPeople } from '@/lib/groups';
import { listTeams } from '@/lib/groups-inbox';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import InboxShell from '@/components/groups/InboxShell';

export const dynamic = 'force-dynamic';

/** Bandeja en tres columnas: lista (este layout), chat y detalles (la página hija). */
export default async function GroupsInboxLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'groups' });
  const [numbers, labels, people, teams] = await Promise.all([
    listNumbers(user.id),
    listLabels(user.id),
    listPeople(user.id, user.team?.id ?? null),
    listTeams(user.id),
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
    <InboxShell
      labels={labels.map((l) => ({ id: l.id, name: l.name, color: l.color }))}
      people={people}
      teams={teams.map((tm) => ({ id: tm.id, name: tm.name }))}
    >
      {props.children}
    </InboxShell>
  );
}
