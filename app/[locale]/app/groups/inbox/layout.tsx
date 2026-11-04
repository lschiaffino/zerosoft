import { RETURN_PATH_HEADER } from '@/lib/return-path';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { isWorkspaceAdmin, requireUser } from '@/lib/session';
import { listLabels, listNumbers, listPeople, listPropertyDefs } from '@/lib/groups';
import { managedAvailable } from '@/lib/groups-provider-managed';
import { listTeams } from '@/lib/groups-inbox';
import { listSavedLists } from '@/lib/groups-org';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import InboxShell from '@/components/groups/InboxShell';
import GetStarted from '@/components/groups/GetStarted';
import SampleBanner from '@/components/groups/SampleBanner';

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
    // Sin números no se renderiza la página hija: un id en la ruta no puede existir. Da 404 con el aviso de
    // Groups dentro de la app (app/[locale]/app/groups/not-found.tsx), p. ej. un link viejo tras borrar el ejemplo.
    if (/\/inbox\/[^/?#]+/.test((await headers()).get(RETURN_PATH_HEADER) ?? '')) notFound();
    return (
      <div className="ui-page">
        <PageHeader title={t('inbox.title')} />
        <EmptyState
          title={t('inbox.noNumbersTitle')}
          body={!isWorkspaceAdmin(user) ? t('sample.askAdmin') : managedAvailable() ? t('inbox.noNumbersBodyQr') : t('inbox.noNumbersBody')}
          action={isWorkspaceAdmin(user) ? <GetStarted managed={managedAvailable()} canEdit /> : undefined}
          product="groups"
        />
      </div>
    );
  }

  // Solo el número de ejemplo: un aviso arriba con cómo seguir.
  const onlySample = numbers.every((n) => n.provider === 'sample');
  const hasSample = numbers.some((n) => n.provider === 'sample');
  // Números agregados que nunca terminaron de conectar: cómo seguir, o probar con el ejemplo.
  const nothingConnected = !hasSample && numbers.every((n) => n.status !== 'connected');
  return (
    <>
      <InboxShell
        banner={
          hasSample ? (
            <SampleBanner canEdit={isWorkspaceAdmin(user)} managed={managedAvailable()} onlySample={onlySample} />
          ) : nothingConnected ? (
            <div className="gr-banner gr-sample-banner is-warn" role="status">
              <span>{t('inbox.pendingBanner')}</span>
              <GetStarted managed={managedAvailable()} canEdit={isWorkspaceAdmin(user)} finish inline />
            </div>
          ) : null
        }
        labels={labels.map((l) => ({ id: l.id, name: l.name, color: l.color }))}
        people={people}
        teams={teams.map((tm) => ({ id: tm.id, name: tm.name }))}
        properties={properties}
        me={me}
        initialLists={lists}
      >
        {props.children}
      </InboxShell>
    </>
  );
}
