import { Suspense } from 'react';
import { requireUser } from '@/lib/session';
import { inboxEntityFor } from '@/lib/track-inbox-panel';
import PlanPage from '@/components/track/planning/PlanPage';
import InboxEntityPane from '@/components/track/InboxEntityPane';
import InboxPaneMissing from '@/components/track/InboxPaneMissing';

export const dynamic = 'force-dynamic';

/** El project de un aviso (updates, recordatorios, comentarios), en el panel de la bandeja. */
export default async function TrackInboxProjectPage(props: { params: Promise<{ locale: string; planId: string }> }) {
  const { locale, planId } = await props.params;
  const user = await requireUser(locale);
  // Mismo alcance que la página del project: uno de otro workspace o que no se ve responde como borrado.
  const plan = await inboxEntityFor('project', planId, user);
  if (!plan) return <InboxPaneMissing kind="project" />;
  return (
    <InboxEntityPane kind="project" id={plan.id}>
      <div className="track-page ui-page tp-page track-inbox-entity-page">
        <Suspense fallback={null}>
          <PlanPage planId={plan.id} panel />
        </Suspense>
      </div>
    </InboxEntityPane>
  );
}
