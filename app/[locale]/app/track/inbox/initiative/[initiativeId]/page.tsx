import { Suspense } from 'react';
import { requireUser } from '@/lib/session';
import { inboxEntityFor } from '@/lib/track-inbox-panel';
import { InitiativePage } from '@/components/track/planning/Initiatives';
import InboxEntityPane from '@/components/track/InboxEntityPane';
import InboxPaneMissing from '@/components/track/InboxPaneMissing';

export const dynamic = 'force-dynamic';

/** La iniciativa de un aviso (updates, comentarios), en el panel de la bandeja. */
export default async function TrackInboxInitiativePage(props: { params: Promise<{ locale: string; initiativeId: string }> }) {
  const { locale, initiativeId } = await props.params;
  const user = await requireUser(locale);
  const initiative = await inboxEntityFor('initiative', initiativeId, user);
  if (!initiative) return <InboxPaneMissing kind="initiative" />;
  return (
    <InboxEntityPane kind="initiative" id={initiative.id}>
      <div className="track-page ui-page tp-page track-inbox-entity-page">
        <Suspense fallback={null}>
          <InitiativePage initiativeId={initiative.id} panel />
        </Suspense>
      </div>
    </InboxEntityPane>
  );
}
