'use client';

import InboxPaneMissing from '@/components/track/InboxPaneMissing';

/** Falló al cargar el issue del panel: la lista sigue; se puede reintentar. */
export default function InboxIssueError({ reset }: { error: Error; reset: () => void }) {
  return <InboxPaneMissing retry={reset} />;
}
