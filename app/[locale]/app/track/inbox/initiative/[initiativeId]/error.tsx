'use client';

import InboxPaneMissing from '@/components/track/InboxPaneMissing';

/** Falló al cargar el iniciativa del panel: la lista sigue; se puede reintentar. */
export default function InboxEntityError({ reset }: { error: Error; reset: () => void }) {
  return <InboxPaneMissing kind="initiative" retry={reset} />;
}
