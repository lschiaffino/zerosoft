import { RETURN_PATH_HEADER } from '@/lib/return-path';
import { CSP_NONCE_HEADER } from '@/lib/csp';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { isWorkspaceAdmin, requireUser } from '@/lib/session';
import { droppedNumbers, listLabels, listNumbers, listPeople, listPropertyDefs } from '@/lib/groups';
import { pageViewer } from '@/lib/groups-page';
import { numberManager } from '@/lib/groups-number-perms';
import { getSelectedLine } from '@/lib/groups-lines';
import { linesPanelsScript } from '@/lib/groups-panels';
import { managedAvailable } from '@/lib/groups-provider-managed';
import { listTeams } from '@/lib/groups-inbox';
import { listSavedLists } from '@/lib/groups-org';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import InboxShell from '@/components/groups/InboxShell';
import { listLineGroups } from '@/lib/groups-line-groups';
import { getKanbanPrefs } from '@/lib/groups-kanban';
import GetStarted from '@/components/groups/GetStarted';
import { mirrorSummary } from '@/lib/fleet/link';
import SampleBanner from '@/components/groups/SampleBanner';

export const dynamic = 'force-dynamic';

/** Bandeja en tres columnas: lista (este layout), chat y detalles (la página hija). */
export default async function GroupsInboxLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'groups' });
  const me = user.actingUser?.id ?? user.id;
  const viewer = await pageViewer(user);
  // Admins, o members con permiso para conectar números: ven el camino para conectar uno.
  const canConnect = numberManager(user).canAdd;
  const [numbers, lineGroups, labels, people, teams, properties, lists, agents, tf] = await Promise.all([
    listNumbers(user.id, viewer),
    // Solo los grupos donde ve alguna línea (lib/groups-line-groups.ts).
    listLineGroups(user.id, viewer),
    listLabels(user.id, viewer),
    listPeople(user.id),
    listTeams(user.id),
    listPropertyDefs(user.id),
    listSavedLists(user.id, me, { viewer }),
    mirrorSummary(user, 'lines'),
    getTranslations({ locale, namespace: 'fleet' }),
  ]);

  if (numbers.length === 0) {
    // Sin números no se renderiza la página hija: un id en la ruta no puede existir. Da 404 con el aviso de
    // Groups dentro de la app (app/[locale]/app/lines/not-found.tsx), p. ej. un link viejo tras borrar el ejemplo.
    if (/\/inbox\/[^/?#]+/.test((await headers()).get(RETURN_PATH_HEADER) ?? '')) notFound();
    return (
      <div className="ui-page">
        <PageHeader title={t('inbox.title')} />
        <EmptyState
          title={t('inbox.noNumbersTitle')}
          body={!canConnect ? t('sample.askAdmin') : managedAvailable() ? t('inbox.noNumbersBodyQr') : t('inbox.noNumbersBody')}
          action={canConnect ? <GetStarted managed={managedAvailable()} canEdit sample={isWorkspaceAdmin(user)} /> : undefined}
          product="groups"
        />
      </div>
    );
  }

  // Solo el número de ejemplo: un aviso arriba con cómo seguir.
  const onlySample = numbers.every((n) => n.provider === 'sample');
  const hasSample = numbers.some((n) => n.provider === 'sample');
  // Números agregados que nunca terminaron de conectar: cómo seguir, o probar con el ejemplo.
  // Una línea que ya tuvo chats y se cayó tiene su propio aviso en la lista (reconectar con QR).
  const nothingConnected = !hasSample && numbers.every((n) => n.status !== 'connected') && (await droppedNumbers(user.id, viewer).catch(() => [])).length === 0;
  return (
    <>
      {/* Anchos de paneles guardados: se aplican antes del primer pintado. */}
      <script nonce={(await headers()).get(CSP_NONCE_HEADER) ?? undefined} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: linesPanelsScript(me) }} />
      <InboxShell
        banner={
          hasSample ? (
            <SampleBanner canEdit={isWorkspaceAdmin(user)} managed={managedAvailable()} onlySample={onlySample} />
          ) : nothingConnected ? (
            <div className="gr-banner gr-sample-banner is-warn" role="status">
              <span>{t('inbox.pendingBanner')}</span>
              <GetStarted managed={managedAvailable()} canEdit={canConnect} sample={isWorkspaceAdmin(user)} finish inline />
            </div>
          ) : null
        }
        labels={labels.map((l) => ({ id: l.id, name: l.name, color: l.color }))}
        people={people}
        teams={teams.map((tm) => ({ id: tm.id, name: tm.name }))}
        properties={properties}
        me={me}
        initialLists={lists}
        numbers={numbers.map((n) => ({ id: n.id, name: n.name || (n.phone ? `+${n.phone}` : ''), phone: n.phone, ownerId: n.ownerId, ownerName: n.ownerName, color: n.color, groupId: n.groupId }))}
        lineGroups={lineGroups.map((g) => ({ id: g.id, name: g.name }))}
        initialLine={await getSelectedLine(viewer)}
        initialKanban={(await getKanbanPrefs(viewer).catch(() => null))?.on ?? false}
        agentsRow={agents ? { href: '/app/lines/agents', label: tf('mirror.row'), unread: agents.unread, waiting: agents.waiting, waitingLabel: tf('mirror.waiting', { n: agents.waiting }) } : null}
      >
        {props.children}
      </InboxShell>
    </>
  );
}
